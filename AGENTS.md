# AGENTS.md — AssetMind AI

Read `docs/assetmind-ai-architecture.md` and `docs/assetmind-ai-execution-plan.md`
for full reasoning, and `docs/assetmind-ai-plan-review.md` for the P0/P1/P2 gap
list that the other two docs were revised against. The evaluation protocol is
FROZEN and its changes require an ADR — see `docs/evaluation-protocol.md`. This file is the short
version OpenCode should hold in context on every task — don't restate its
contents back in commit messages or PRs, just follow it.

## What this is

An IILM capstone project: a GenAI agent (not a fixed pipeline) that
investigates industrial-asset faults using tool-calling, grounded in
retrieved documents, structured asset data, and a rule-based guardrail
signal. Full-stack **single Next.js app** — no separate backend service.

This repo *is* the app. It's on **Next.js 16** — read
`node_modules/next/dist/docs/` before writing code; Turbopack is
default, `params`/`searchParams` are Promises, `middleware.ts` is now
`proxy.ts`, and `next lint` no longer exists.

## Stack (do not introduce alternatives without asking)

- Next.js (App Router), TypeScript, Tailwind
- Prisma v7 via `@prisma/adapter-pg` → PostgreSQL + pgvector (structured
  data, embeddings, and keyword search via `tsvector` — one database, no
  OpenSearch). Pin `prisma@7`; `latest` currently resolves to an 8.x RC.
  Deployed env needs a pooler (RDS Proxy/PgBouncer) — serverless + RDS
  exhausts `max_connections` without one.
- Vercel AI SDK (`ai` package, **v7**) for the agent loop (`streamText`/
  `generateText` with `tools` + `stopWhen: isStepCount(n)`) and `useChat`
  on the frontend
- Zod for request validation, tool parameter schemas, and the versioned
  `ChatMessage.evidence` shape
- Inngest for background jobs (document ingestion)
- OpenAI API directly for chat + embeddings — **not** AWS Bedrock
- AWS S3 (raw docs) + RDS/Aurora Postgres (deployed DB) + Secrets Manager
  + IAM + CloudWatch — nothing else on AWS
- Clerk for auth (Clerk owns users; `Chat.clerkUserId`, no Prisma `User`)
- Vitest for unit tests, Playwright for the chat smoke test, GitHub Actions
  for `lint → typecheck → test → next build`

## Migrations: hand-authored, applied with `migrate deploy`

**Do not run `npx prisma migrate dev`.** It builds a shadow database and
diffs it against `schema.prisma`. Prisma cannot represent `vector` columns,
`tsvector` columns, or their GIN index, so it always concludes they are drift
and generates `DROP INDEX "DocumentChunk_searchVector_idx"` plus
`ALTER COLUMN "searchVector" DROP DEFAULT`. The second one is a hard Postgres
error on a generated column, and because auto-generated migration names sort
*before* the migration that creates the index, the whole thing fails with
P3018 / 42704.

The supported loop:

```bash
npx prisma generate
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# review the output, strip the DocumentChunk_searchVector_idx / searchVector
# DEFAULT lines, hand-write it into a new prisma/migrations/<ts>_<name>/ folder
npx prisma migrate deploy
```

Corollary for CI: a bare `prisma migrate diff` drift gate is not viable here
until it filters those two known statements. Use `migrate status` instead, or
filter deliberately.

**Pin `npx prisma@7` in CI.** `npx prisma` and `npm install prisma` now
resolve to the **Prisma 8 RC CLI**, which does not read `schema.prisma` and has
no `generate`, `migrate dev`, or `db push`. The local `^7.10.0` pin protects
`npm run` scripts, but any `npx prisma ...` that falls through to a fetch
would get the v8 CLI. Write `npx prisma@7 <cmd>` in workflows.

## AI SDK v7 API contract (do not use v4/v5-era names)

Verified against the official v7 migration guide and `ai@7.0.60` reference:

- Step ceiling: `stopWhen: isStepCount(n)`. **`maxSteps` is gone**, and the
  helper `stepCountIs` was renamed to `isStepCount`.
- `system:` became **`instructions:`**. System messages passed inside
  `prompt`/`messages` need `allowSystemInMessages: true`.
- `onFinish` became **`onEnd`**.
- `StreamTextResult.fullStream` became **`.stream`**.
- Top-level `usage`, `content`, `toolCalls`, `files`, `sources`, and
  `warnings` now cover **all** steps. Final-step-only values live under
  **`.finalStep`**. For streaming, `await result.finalStep` first.
- Evaluations must log `totalUsage` (all steps) and `finalStep.usage`
  separately — RQ4 cost/latency reporting depends on not conflating them.

## Core architectural rule

There is no RAG "pipeline." There is an agent with a tool registry:
`searchDocumentsVector`, `searchDocumentsKeyword`, `getAssetContext`,
`getFaultHistory`, `getMaintenanceHistory`, `checkGuardrails`. The model
decides which to call. Don't hardcode a fixed retrieve-then-generate
sequence — if a task description implies that, flag it rather than
building it.

`checkGuardrails` is the AI4I 2020 rule set — **not** a trained ML model.
Don't add model training unless explicitly asked.

The four rules below were **verified row-by-row against
`data/raw/ai4i2020.csv`**, not copied from the docs. HDF, PWF and OSF
reproduce their label columns *exactly*. Do not "simplify" them — see
`docs/adr/0002-ai4i-guardrail-rules.md` for the measurements and the two
rules that cannot be predicted.

| Mode | Condition | Label rows | Reproduces label? |
| --- | --- | --- | --- |
| HDF | `abs(processTemp − airTemp) < 8.6` **AND** `speed < 1380` | 115 | exact, 115/115 |
| PWF | power `= torque × 2π × speed / 60`; fail if `< 3500 W` or `> 9000 W` | 95 | exact, 95/95 |
| OSF | `toolWear × torque > 11000` (L) / `12000` (M) / `13000` (H) | 98 | exact, 98/98 |
| TWF | — not a threshold — | 46 | **impossible** |
| RNF | — not a threshold — | 19 | **impossible** |

Three traps that will silently corrupt RQ3 if you get them wrong:

- **OSF is per-product-type.** A flat `11000` threshold for every type
  yields 125 rows instead of 98. The `L`/`M`/`H` split is load-bearing.
- **PWF is power in watts, not torque × rpm.** `torque × speed` ranges
  10,967–99,980 across the dataset, so any "torque × speed" rule is wrong
  by construction. The `2π/60` conversion is required.
- **HDF needs the absolute difference.** The spec says "the difference
  between air- and process temperature is below 8.6 K". Read literally as
  `airTemp − processTemp < 8.6` it fires on nearly every row. Use
  `Math.abs(...)`. (On AI4I `process > air` always, so the abs and signed
  forms coincide here — but only because of that.)
- **There is no "1413" rule.** 1413 is just a rotational-speed value that
  happens to appear in 30 rows. Any doc claiming a "TWF torque × speed
  threshold of 1413" is wrong. Do not reintroduce it.
- **TWF and RNF are random, not thresholded.** In AI4I the tool is replaced
  *or fails* at a randomly chosen wear time in 200–240 min, 69 replaced /
  51 failed. Of the 790 rows in that wear band only 46 are labelled TWF,
  and 3 TWF rows sit outside the band entirely. RNF is a per-row coin
  flip. Neither is predictable from process parameters, so per-mode
  precision/recall for them is **not a meaningful metric**. Report the
  deterministic three, and state TWF/RNF as irreducibly random rather
  than scoring them. See the ADR.

Temperatures are Kelvin (dataset-native). Store K, display °C.

The source dataset is `data/raw/ai4i2020.csv` — read `data/README.md` before
parsing it. It has a UTF-8 BOM (first column is `﻿UDI`, not `UDI`) and
`Torque [Nm]` is a float while rotational speed and tool wear are integers.

## Conventions

- Server Components for reads (direct Prisma queries, no internal API
  hop). **No React Query in the read path** — it would put back the API hop
  the architecture deliberately avoids. Server Actions for simple
  mutations. Route Handlers only where a real streaming/external endpoint
  is needed (chat, webhooks).
- Every agent tool call + result gets logged to `ChatMessage.evidence` as
  it happens — this is both the UI's evidence panel and the eval data. The
  schema is versioned and validated on read.
- Every retrieval/generation config used for evaluation is expressed as
  *which tools are registered for that run*, not a separate code path.
  `buildToolRegistry(names)` is the single entry point, shared by the eval
  harness and the UI's config selector — never fork it.
- Tools return a `ToolOutcome` (`ok: true` / `ok: false` + typed error
  code). They don't throw; a throw kills the stream and teaches the model
  nothing.
- Answers carry machine-checkable citations (`[chunk:<id>#<n>]`,
  `[fault:<id>]`, `[guardrail:<mode>]`) so traceability is verified by a
  script, not by eye.
- Per-turn resource limits are mandatory: step ceiling
  (`stopWhen: isStepCount(n)`), token budget,
  per-tool timeout with one retry, per-user daily quota.
- The system prompt is versioned and held constant across eval configs; log
  `SYSTEM_PROMPT_VERSION` and the git SHA with every run.
- Seed data uses a **fixed RNG seed** so re-seeding is reproducible.
- Decisions go in `docs/adr/` at the time they're made, not reconstructed
  later.

## Working style

- Keep tasks small — "add the `getFaultHistory` tool," not "build the
  agent." If a task looks like it needs more than one focused change,
  say so before starting rather than sprawling across files.
- Don't silently swap a stack decision above for something else because
  it seems easier — ask first.
- Don't touch the database (migrations, seeds, writes) without explicit
  approval.
- Don't add ML training, reranking, or a third-party observability/
  eval platform unless evaluation results or an explicit request justify it.
- This is a research prototype with a paper attached: correctness and
  traceability (can every claim in an agent's answer be traced to a tool
  call?) matter more than speed of shipping.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
