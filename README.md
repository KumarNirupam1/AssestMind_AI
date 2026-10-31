# AssetMind AI

A GenAI fault-investigation agent for industrial assets. The model is not a
fixed retrieve-then-generate pipeline: it chooses from a registry of tools
(document search, asset context, fault history, maintenance history, and a
rule-based guardrail check), and every claim it makes is traceable to a logged
tool call.

Built as an IILM capstone project. The research protocol is frozen — see
[`docs/evaluation-protocol.md`](docs/evaluation-protocol.md) before changing
anything that affects evaluation.

## What makes it different

- **Agent, not pipeline.** `buildToolRegistry(names)` is the single entry point
  shared by the UI and the eval harness; a "retrieval config" is just a tool
  subset, never a separate code path.
- **Machine-checkable evidence.** Answers cite `[chunk:<id>#<n>]`,
  `[fault:<id>]`, and `[guardrail:<mode>]`. Each turn's tool calls and evidence
  are persisted to `ChatMessage.evidence` (versioned, Zod-validated on read).
- **Deterministic guardrails.** `checkGuardrails` implements the AI4I 2020 rule
  set (HDF, PWF, OSF), verified row-by-row against the dataset. TWF and RNF are
  irreducibly random in AI4I and are reported as such.
- **Server-first reads.** Server Components query Prisma directly; there is no
  internal API hop and no client-side query cache.

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Agent | Vercel AI SDK v7 (`streamText`, `isStepCount`, UI message streams) |
| Data | PostgreSQL 16 + pgvector; Prisma 7 via `@prisma/adapter-pg` |
| Auth | Clerk (`Chat.clerkUserId`; no local user table) |
| Jobs | Inngest (document ingestion; deferred) |
| Storage | AWS S3 (raw documents), Secrets Manager, IAM, CloudWatch |
| Models | OpenAI chat + `text-embedding-3-small` (1536-dim) |

## Quick start

Requirements: Node 22, PostgreSQL 16 with the `vector` extension, a Clerk
application, and an OpenAI API key (only needed once you exercise retrieval).

```bash
cp .env.example .env        # Prisma CLI, scripts
cp .env.example .env.local  # Next.js runtime
npm install
npx prisma@7 generate
npm run db:migrate          # migrate deploy — never `prisma migrate dev`
npx prisma@7 db seed
npm run dev
```

`prisma migrate dev` is intentionally unsupported: its shadow database cannot
represent the `vector`/`tsvector` columns or the GIN index, so it reports false
drift and fails. Migrations are hand-authored and applied with
`migrate deploy`. See [`AGENTS.md`](AGENTS.md).

### Environment

All variables are documented in [`.env.example`](.env.example). The important
ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (`sslmode=require` for RDS) |
| `DATABASE_POOL_MAX` | `pg.Pool` size; keep small on serverless (default 5) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk |
| `OPENAI_API_KEY` | Chat + embeddings |
| `ASSETMIND_EMBED_PROVIDER` | `deterministic` (offline tests) or `openai` |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Background ingestion (optional) |
| `AWS_REGION`, `S3_DOCUMENT_BUCKET` | Document storage (local dev uses the `assestmind` profile) |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run db:migrate` | `prisma migrate deploy` (pinned to v7) |
| `npm run setup:pgvector` | Enable the `vector` extension |
| `npm run embed:backfill` | Backfill document embeddings |
| `npm run verify:rules` | Re-check guardrail rules against the dataset labels |
| `npm run verify:retrieval` | Retrieval smoke test against the database |
| `npm run verify:citations` | Verify citations in stored evidence |
| `npm run eval:run` | Phase 6B run engine (single run or full grid) |

## Evaluation

The frozen protocol is 24 labelled questions × 5 tool configs × 3 repeats =
360 runs, `gpt-4o-mini` at temperature 0. Each run is written as a manifest
validated by `EVAL_RUN_SCHEMA`.

```bash
set ASSETMIND_EMBED_PROVIDER=openai   # PowerShell: $env:ASSETMIND_EMBED_PROVIDER="openai"
npm run embed:backfill
npm run verify:retrieval
npm run eval:run -- --only q001 --config 1
npm run verify:citations
npm run eval:run
```

Agent guardrails: step ceiling (`isStepCount(5)`), output-token cap, a 40k
per-turn token budget, a 400k per-user daily quota backed by `DailyUsage`, a
5s per-tool timeout, and a 40-entry evidence cap per turn.

## Testing and CI

`npm test` runs Vitest; `.github/workflows/ci.yml` runs lint → typecheck →
guardrail-vs-dataset → unit tests → production build on every push and PR, and
deliberately never touches a database.

## Deployment

Target is Vercel + AWS RDS in `ap-south-1`. Set the same environment variables
in Vercel, run `migrate deploy` against RDS before the first deploy, and keep
Prisma's pool small (RDS Proxy is unavailable on the free tier). Do not set AWS
access keys in Vercel — the app reads S3 through an IAM role. Health check:
`GET /api/health`.

## Project layout

```
app/                 routes: dashboard, assets, chat, monitoring, api/chat, api/health
features/            assets, chat, guardrails, ingestion, evaluation, monitoring
lib/agent/           registry, runtime, prompts, limits, quota, chat-store, tools
lib/db.ts            Prisma client + pg adapter
prisma/              schema, hand-authored migrations, seed
scripts/             verification and evaluation entry points
docs/                architecture, execution plan, protocol, ADRs, checklist
```

## Documentation

- [`docs/assetmind-ai-architecture.md`](docs/assetmind-ai-architecture.md)
- [`docs/assetmind-ai-execution-plan.md`](docs/assetmind-ai-execution-plan.md)
- [`docs/evaluation-protocol.md`](docs/evaluation-protocol.md)
- [`docs/adr/`](docs/adr/) — decision records
- [`AGENTS.md`](AGENTS.md) — contributor/agent rules

## Limitations

- Sensor channels are AI4I 2020 milling-machine data used as a declared
  stand-in for pumping assets (ADR 0001).
- The live monitoring page is a deterministic simulation seeded from stored
  readings; it does not write telemetry.
- Document ingestion (S3 + Inngest) is implemented but deferred; retrieval runs
  against previously ingested chunks.
