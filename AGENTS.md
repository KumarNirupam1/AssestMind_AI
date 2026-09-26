# AGENTS.md — AssetMind AI

Read `docs/assetmind-ai-architecture.md` and `docs/assetmind-ai-execution-plan.md`
for full reasoning, and `docs/assetmind-ai-plan-review.md` for the P0/P1/P2 gap
list that the other two docs were revised against. This file is the short
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
  `generateText` with `tools` + `maxSteps`) and `useChat` on the frontend
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

## Core architectural rule

There is no RAG "pipeline." There is an agent with a tool registry:
`searchDocumentsVector`, `searchDocumentsKeyword`, `getAssetContext`,
`getFaultHistory`, `getMaintenanceHistory`, `checkGuardrails`. The model
decides which to call. Don't hardcode a fixed retrieve-then-generate
sequence — if a task description implies that, flag it rather than
building it.

`checkGuardrails` is the AI4I 2020 rule set — **not** a trained ML model.
Don't add model training unless explicitly asked. Two things about it are
easy to get wrong and are documented in architecture §3.2:

- The rules are **compound conditions**, not single thresholds (e.g. HDF is
  `(processTemp − airTemp) < 8.6 K` **AND** `rotationalSpeed < 1380 rpm`).
- **RNF is a 0.1% random chance, not a rule.** Never fake it as a threshold.
  Exclude it and document, or seed it and report the seed.

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
- Per-turn resource limits are mandatory: `maxSteps` ceiling, token budget,
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
