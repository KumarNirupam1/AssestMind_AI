# AssetMind AI — Full Architecture Documentation

Rewritten from an agent-developer perspective: this is a GenAI agent with
tools, not a fixed RAG pipeline. Also updates the AWS story now that
Bedrock is out (OpenAI API for all models) and resolves a couple of things
the earlier docs left open.

---

## 1. System overview

An engineer asks a question about an asset. An LLM agent, given a set of
tools backed by your data, decides which tools to call, calls them
(possibly more than one, possibly in sequence based on what it learns),
and synthesizes an answer with the evidence it gathered. The "predictive
maintenance" signal and the "RAG retrieval" aren't separate subsystems —
they're both just tools the same agent can reach for.

This is the single biggest structural change from the earlier docs: there
is no more "RAG pipeline" as a fixed sequence of steps. There's an agent
loop and a tool registry.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────┐
│                Next.js app (Vercel)                   │
│                                                          │
│  Dashboard (Server Components)                          │
│    → direct Prisma reads, no agent involved              │
│                                                          │
│  Investigation chat (Client Component, useChat)          │
│    → app/api/chat/route.ts                                │
│         → agent loop (Vercel AI SDK: generateText/         │
│           streamText, tools, maxSteps)                     │
│         → calls whichever tools it decides it needs         │
│                                                          │
│  Ingestion trigger (Server Action / Route Handler)         │
│    → enqueues an Inngest event, returns immediately          │
└───────────┬─────────────────────┬───────────────────────┘
            │                     │
            ▼                     ▼
   ┌─────────────────┐   ┌─────────────────────┐
   │ Inngest           │   │ OpenAI API            │
   │ (background jobs) │   │ - chat/completions     │
   │ - doc ingestion    │   │ - embeddings            │
   │ - chunk + embed    │   │   (text-embedding-3-*)  │
   └────────┬──────────┘   └─────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────┐
│  PostgreSQL + pgvector (AWS RDS/Aurora)        │
│  - structured: Asset, Component, FaultRecord,    │
│    MaintenanceLog, Chat, ChatMessage               │
│  - DocumentChunk: embedding (pgvector) AND          │
│    a tsvector column (Postgres full-text search)     │
│    → vector search + keyword search, one database,     │
│      no separate search engine needed                    │
└─────────────────────────────────────────────┘
            ▲
            │
   ┌─────────────────┐
   │ AWS S3             │
   │ raw manuals/SOPs/   │
   │ reports, pre-ingest │
   └─────────────────┘
```

---

## 3. The agent, concretely

Built with the Vercel AI SDK's tool-calling primitives (`generateText` /
`streamText` with a `tools` object and `maxSteps` for multi-step agent
loops) — this is the "agent" without needing a separate agent framework.
The SDK already does the tool-call loop: model decides to call a tool →
tool runs → result goes back to the model → model decides whether to call
another tool or answer.

**Tool registry:**

| Tool | Backed by | What it returns |
|---|---|---|
| `searchDocumentsVector` | pgvector similarity search on `DocumentChunk.embedding` | semantically relevant chunks |
| `searchDocumentsKeyword` | Postgres full-text search on `DocumentChunk`'s tsvector column | exact-match/keyword-relevant chunks (fault codes, part numbers) |
| `getAssetContext` | Prisma read on `Asset`/`Component` | metadata for the asset in question |
| `getFaultHistory` | Prisma read on `FaultRecord` | recent faults, optionally time-filtered |
| `getMaintenanceHistory` | Prisma read on `MaintenanceLog` | recent maintenance events |
| `checkGuardrails` | the AI4I-2020 rule engine (§3.2) | current rule-based status for the asset, per rule, with the observed values and thresholds that produced it (not a trained model) |

Each tool is a plain function with a Zod schema describing its
parameters (Zod is already in your stack for request validation, so this
reuses the same library rather than adding a second schema tool). The
model sees the tool's name, description, and parameter schema, and
decides when to call it based on the user's question — you don't
hardcode "always call search first."

**Evidence trace:** every tool call and its result gets logged into
`ChatMessage.evidence` (already in your schema) as the call happens, not
reconstructed afterward. This is both your "evidence panel" data source
for the UI and your raw data for evaluating tool-selection accuracy in
Phase 6.

**Variant ladder, reframed as tool availability** (same RQs, different
implementation):

1. No tools — baseline LLM
2. + `searchDocumentsVector` only
3. + `searchDocumentsKeyword` (now the agent can choose vector, keyword,
   or both — this is your hybrid-retrieval comparison, decided by the
   agent per query rather than hardcoded)
4. + `getAssetContext`, `getFaultHistory`, `getMaintenanceHistory`
   (structured-data tools)
5. + `checkGuardrails`

Running the same query set through configs 1–5 and looking at which
tools the agent actually chose to call, and how that changed groundedness,
answers RQ1–RQ4 directly. RQ5 (traceable evidence) is answered by
checking whether the tool-call log actually supports every claim in the
final answer.

### 3.1 The five research questions

These were referenced by number throughout the earlier drafts but never
written down. They are stated here explicitly, because the query set, the
metrics, and the paper's structure all follow from them — if these change,
Phase 6 has to be re-planned.

- **RQ1 — Groundedness gain from retrieval.** How much does giving the
  agent document retrieval (vector, then keyword, then both) improve
  groundedness — the share of factual claims in an answer that are
  entailed by a tool result — over a no-tools baseline?
- **RQ2 — Value of structured-data tools.** What does adding the
  structured-asset tools (`getAssetContext`, `getFaultHistory`,
  `getMaintenanceHistory`) contribute on top of document retrieval, and
  do they substitute for or complement retrieval?
- **RQ3 — Guardrail tool usage.** Does the agent call `checkGuardrails`
  appropriately — including when the rule signal is weak, where calling it
  may be unnecessary or misleading? Does it over-rely on the guardrail
  signal as a shortcut for avoiding retrieval?
- **RQ4 — Cost/latency trade-off.** What do groundedness gains cost in
  latency, tokens, and money per turn, and where does the curve flatten?
- **RQ5 — Traceability.** Can every factual claim in an answer be traced
  to a specific tool call and its result, verified mechanically rather
  than by inspection?

Config membership maps to RQs as: 1 baseline (control for RQ1–RQ4), 2–3
retrieval ablation (RQ1), 4 structured-data delta (RQ2), 5 full system
(RQ3, and the system evaluated in RQ4/RQ5).

### 3.2 The guardrail rules, precisely

`checkGuardrails` implements the AI4I-2020 rule set as documented by UCI.
These are **compound conditions, not single thresholds** — a
single-cutoff implementation will disagree with the dataset's own labels,
which is both a correctness bug and an easy criticism for a panel member
familiar with the dataset.

| Mode | Condition (dataset-native units) |
|---|---|
| HDF — heat dissipation | `(processTemp − airTemp) < 8.6 K` **AND** `rotationalSpeed < 1380 rpm` |
| PWF — power | `ω = rotationalSpeed × 2π / 60` (rad/s); `P = torque × ω`; fails if `P < 3500 W` **or** `P > 9000 W` |
| OSF — overstrain | `toolWear × torque > 11000` (variant L), `> 12000` (M), `> 13000` (H) |
| TWF — tool wear | tool is replaced or fails at a per-tool random wear time drawn from `[200, 240]` min |
| RNF — random | 0.1% chance regardless of parameters |

**RNF is not a deterministic rule and must not be faked as one.** Either
exclude it from the deterministic engine and state that exclusion in the
paper, or implement it as a seeded probabilistic check and report the
seeding. A fabricated threshold here would be a serious integrity problem.

**Units.** AI4I temperatures are Kelvin (air ≈ 300 K, process ≈ 310 K).
Store Kelvin so every reading traces back to the source CSV, and convert
to °C for display only. The frequently-cited "21.1 °C" style thresholds
are an artefact of this unit confusion and should not be used.

**Validation.** Replay all 10,000 dataset rows through the implemented
rules and report agreement with the dataset's own `Machine failure` /
mode flags. This is a cheap, citable number that turns "we implemented
some thresholds" into "we validated a rule engine," and it is the evidence
that the mapping from dataset rows to your synthetic asset catalog is
honest.

### 3.3 Agent runtime requirements

The tool registry alone is not an agent; these are the runtime properties
that make it behave predictably enough to evaluate.

**System prompt, versioned.** `lib/agent/prompts.ts` exports one versioned
system prompt carrying: role and scope; the grounding obligation (every
factual claim must be traceable to a tool result in this conversation, no
outside knowledge); the **citation format** (`[chunk:<id>#<n>]`,
`[fault:<id>]`, `[guardrail:<mode>]`, so citations are machine-checkable);
an abstention instruction (say the data does not answer this rather than
speculate); and per-tool *guidance* about when to reach for it — guidance,
not an ordered procedure, since the model choosing the order is the entire
architectural premise. Log `SYSTEM_PROMPT_VERSION` per run. The prompt is
an experimental variable: hold it constant across configs 1–5, and if you
change it, report that as an ablation.

**Tools return outcomes, not exceptions.** One shape for every tool:

```ts
type ToolOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: "NOT_FOUND" | "INVALID_INPUT" | "TIMEOUT" | "UPSTREAM"; message: string } }
```

A tool that throws kills the stream and teaches the model nothing. A tool
that returns `ok: false` lets the model see the failure and adapt ("no
fault history for that asset; here is what I can tell you instead"). This
is a real behavioural difference worth a line in the paper.

**Per-turn resource limits.** A `maxSteps` ceiling (start at 5), a
per-turn token budget, a per-tool timeout (~5 s) with a single retry before
degrading to `ok: false`, and a per-user daily token quota enforced
server-side. The chat route is the most expensive and most abusable
endpoint in the app; without these, one confused agent loop is a real bill.

**Context-window management.** Six tools returning k results each will
overflow the context on a broad question. Cap results per tool (e.g. top-5
chunks, not top-20), truncate chunk text to a fixed length, and set a total
evidence budget. Note this is also an **experimental confound**: config 5
carries far more context than config 1, so part of any groundedness gain is
just "more tokens". Cap it, and say so in the report rather than letting a
reviewer find it.

**Citation verification.** Because traceability is RQ5, check it
mechanically rather than by eye: a post-pass over each answer that
extracts every `[...]` citation, confirms the id exists in that turn's
`evidence`, and flags uncited factual sentences. The result is both the
traceability metric and a UI affordance ("2 claims in this answer are not
traceable").

**Streaming and persistence.** Persist the assistant message and its
evidence incrementally, not only on completion, so a client disconnect
mid-stream does not produce a hole in the eval data. Render tool calls in
the evidence panel **as they arrive** — watching the agent decide to call
`getFaultHistory` and then `checkGuardrails` is the most persuasive thing
the demo can show.

**Untrusted document content.** Ingested manuals are untrusted text fed to
a model that can act. State in the system prompt that document content is
data, not instructions, and include at least one injection-resistance case
in the eval query set. A quantified result here is worth a paragraph in
the paper.

### 3.4 One registry, parameterised by tool subset

Configs 1–5 are **not** five pipelines. They are five subsets of a single
registry, selected by name:

```ts
const TOOL_CONFIGS = {
  1: [],
  2: ["searchDocumentsVector"],
  3: ["searchDocumentsVector", "searchDocumentsKeyword"],
  4: ["searchDocumentsVector", "searchDocumentsKeyword",
      "getAssetContext", "getFaultHistory", "getMaintenanceHistory"],
  5: [...all six],
} as const;
```

`buildToolRegistry(names: ToolName[])` returns the tools object for
`streamText`. Both the eval harness and the UI's tool-config selector call
this one function — so the demo and the experiment can never drift apart.
The UI selector matters for Phase 9: showing the same question answered
twice, with visibly different tool use, is the core demo moment.

---

## 3A. Data layer decisions

These are not in the original draft. All of them are cheap now and
expensive to retrofit.

**Connection management under serverless.** The topology is Vercel
(serverless) → Aurora/RDS. Every serverless invocation opens its own
Postgres connection, so under any real concurrency you exhaust
`max_connections` and production fails in a way local dev never
reproduced. Use `@prisma/adapter-pg` (so pooling is explicit and
`max` is yours to set) plus **RDS Proxy or PgBouncer** in front of Aurora in
the deployed environment. A small `max_connections` on the local Docker
Postgres will surface the same constraint sooner, which is the point.

**Embedding and chunker versioning.** `DocumentChunk` must record
`embedModel`, `embedDim`, and `chunkerVersion`. Change the embedding model
or chunk size and every existing vector is stale — similarity search still
returns results, just meaningless ones, and Phase 3 and Phase 6 data become
inconsistent without any error being raised. Policy: on change, re-ingest
everything; never mix versions in one index.

**Vector index choice.** At this corpus size (tens of documents' worth of
chunks) **exact search is both fast enough and exactly correct**. Use exact
scan for evaluation runs so ANN approximation is not a confound. If an HNSW
index is added for realism, report `ef_search` and acknowledge the
approximation. Also: pgvector's `<=>` is cosine distance and requires
normalised vectors, `<->` is L2 — use the same operator on the write and
query paths, and assert that `text-embedding-3-small` output is normalised
rather than assuming it.

**Ordinary indexes and pagination.** `getFaultHistory` supports optional
time filtering, so index `(assetId, occurredAt)`; index foreign keys
generally. Paginate the dashboard lists (asset list, fault history,
maintenance log) with a cursor on a stable indexed column from the start —
retrofitting pagination into Server Components already returning
`findMany()` is unpleasant.

**`ChatMessage.evidence` needs a typed, versioned shape.** It is
simultaneously the UI's data source, the eval parser's input, and the
evidence for RQ5. An unversioned `Json` blob will break the eval parser
the first time a tool result shape changes. Define a Zod schema, version
it, and validate on read so old rows fail loudly rather than silently.

**`SensorReading` is missing from the data model.** `checkGuardrails` is a
rule engine over sensor readings, and the original 8-model list has nowhere
to put them. Add `SensorReading` (asset, timestamp, air/process temperature
in K, rotational speed, torque, tool wear, quality variant) and store the
dataset's five failure-mode flags **as ground-truth columns** — you need
the original labels to score your own rule engine.

**Asset naming vs. the dataset.** AI4I 2020 describes a **simulated milling
machine**; it contains no pumps. Any asset named `Pump-102` is
inconsistent with the sensor data behind it, and a panel will notice. Either
name assets for what the data represents (machining centres) or state the
abstraction explicitly and argue it. This is a team decision, recorded in
`assetmind-ai-plan-review.md` §J1.

---

## 4. AWS services — with Bedrock out

Bedrock was doing two jobs in the originally approved flow: hosting the
LLM, and (implicitly) motivating OpenSearch as its natural retrieval
partner. With OpenAI API replacing Bedrock for models, it's worth
re-deriving what AWS is actually for here, rather than keeping OpenSearch
around out of inertia.

| Service | Role | Why |
|---|---|---|
| **S3** | Raw document storage (manuals, SOPs, inspection reports) before ingestion | Standard object storage, no reason to change this |
| **RDS or Aurora Serverless v2 (PostgreSQL) + pgvector** | Structured data + embeddings + full-text search — everything except raw files | One database instead of Postgres-plus-OpenSearch; Postgres's native `tsvector`/`ts_rank` full-text search covers the "keyword" half of hybrid retrieval, so a separate search engine isn't needed once Bedrock (OpenSearch's usual pairing) is gone |
| **Secrets Manager** | OpenAI API key, DB credentials in the deployed environment | Keeps secrets out of environment files in the deployed app |
| **IAM** | Access policies scoping what the app can touch in S3/RDS/Secrets Manager | Standard least-privilege practice, also a legitimate line in your report under "engineering practices" |
| **CloudWatch** | Logs/metrics for RDS and S3 access | Lightweight, comes free with using those services — don't build custom monitoring when this exists |

**What's dropped and why:** OpenSearch. It was solving a problem
(hybrid retrieval infrastructure) that Postgres already solves once
you're not routing generation through Bedrock's ecosystem. Dropping it is
a real, defensible engineering decision — cite it as one in your report
(your abstract already gives you the language: "AWS just supplies the
environment these components run in," so simplifying which specific AWS
services doesn't touch the research questions).

**What's NOT here:** ECS/Fargate, Lambda, SQS. Vercel hosts the app and
Inngest (below) handles background jobs — introducing more AWS compute
than S3 + RDS adds infrastructure to learn and pay for without adding
anything to your actual research contribution. If you specifically want
more AWS surface area for the "engineering practices" section of your
report, Lambda + SQS as an alternative to Inngest is the natural next
thing to reach for — but it's optional, not required.

---

## 5. Background jobs: Inngest vs BullMQ

Document ingestion (chunk + embed a manual) is the one workload that
doesn't fit a normal request/response cycle. Two real options:

| | Inngest | BullMQ |
|---|---|---|
| Infra needed | None — it's a hosted service with a generous free tier, functions defined right inside your Next.js app | Redis instance + a separate long-running worker process |
| Fits Vercel's serverless model | Yes — designed for exactly this (event triggers a function, Vercel just needs to expose one Route Handler for Inngest to call into) | Not naturally — BullMQ workers need to keep running, which serverless functions don't do; you'd need a separate always-on process (Fly.io, Railway, a small EC2 instance) |
| Retries / step observability | Built in — each step of a multi-step job (chunk → embed → write) is durable and replayable, and you get a dashboard showing exactly what ran | You build this yourself, or add a UI (Bull Board) on top |
| Cost/dependency | Third-party SaaS dependency (free tier is generous, likely enough for a capstone) | Self-hosted, no external dependency, but more infra to run and maintain |

**Recommendation: Inngest.** Given you're deploying to Vercel, it fits
the deployment model directly, and the step-level observability is
genuinely useful for a research prototype where you'll want to see
exactly what an ingestion job did when something goes wrong. BullMQ is
the right call only if you specifically want zero third-party SaaS
dependencies and are fine running a separate worker process — worth
reconsidering only if Inngest's free tier limits become a real problem.

---

## 6. Tooling list — what else this needs to be solid, not just working

| Purpose | Tool | Why |
|---|---|---|
| Agent + tool calling, streaming | Vercel AI SDK (`ai` package) | Already decided — covers `generateText`/`streamText` with tools, `useChat` on the frontend, `embed`/`embedMany` for embeddings |
| Tool parameter validation | Zod | Already in your stack for request validation; the AI SDK's `tool()` helper takes a Zod schema directly, so this is one library doing both jobs |
| Document parsing (PDF manuals/SOPs) | `pdf-parse` or `unpdf` for straightforward text extraction; consider `unstructured.io`'s API only if your source documents have complex tables/layouts | Keep it simple first — most manuals are extractable as plain text; only reach for a heavier parsing service if plain extraction loses structure you need |
| Background jobs | Inngest | See §5 |
| Reranking (only if evaluation shows it's needed) | A second, cheap LLM call scoring relevance, or Cohere's Rerank API | Optional — only needed if your evaluation shows raw hybrid retrieval isn't ranking well enough; don't add it preemptively |
| Evaluation harness | A small custom TS script driving your query set through each config and logging results (straightforward given `ChatMessage.evidence` already captures what you need); Promptfoo is worth a look if you want a more structured eval runner | This is Phase 6's actual deliverable; don't outsource the *judgment* to a tool, but a runner that automates *running* the query set through each config saves real time |
| Cost/latency tracking | Log token usage and duration per agent turn into your own table (the AI SDK's responses include usage data) | Your abstract's evaluation explicitly needs latency and cost numbers per config; capturing this yourself is a few lines of logging, not a new dependency — skip a third-party observability platform (Helicone, LangSmith) unless you specifically want their dashboarding |
| Postgres driver + pooling | `@prisma/adapter-pg` (with `pg`), plus RDS Proxy or PgBouncer in the deployed env | Serverless → RDS exhausts `max_connections` without an explicit pool; see §3A |
| Unit testing | Vitest | The guardrail rules and every tool are pure functions — the cheapest real test coverage available, and the rule engine is the correctness claim of the project |
| End-to-end / smoke | Playwright | One test posting to `/api/chat` catches AI SDK version breakage that unit tests cannot |
| CI | GitHub Actions | `lint → typecheck → unit tests → prisma migrate diff → next build`; also catches schema drift across three developers |
| Error tracking | Sentry (`@sentry/nextjs`) | Free tier is sufficient. Distinct from the "observability platform" declined above — this is error reporting, not trace analytics |
| Auth | Auth.js (`next-auth`) | v5 is published as `5.0.0-beta.x` and targets App Router conventions; v4 stable predates them. Pick deliberately and record it — see `assetmind-ai-plan-review.md` §J2 |

Nothing above is essential in the sense of "the project doesn't work
without it" except Vercel AI SDK, Zod, and a document parser. Inngest and
the eval harness are the two that meaningfully raise the ceiling on
quality (reliable ingestion, and evaluation you can actually trust) for
modest added complexity.

---

## 7. Deployment topology

| Component | Where |
|---|---|
| Next.js app | Vercel |
| Background jobs | Inngest (hosted) |
| Structured data + vectors + full-text search | AWS RDS or Aurora Serverless v2 PostgreSQL, pgvector enabled |
| Connection pooling | RDS Proxy (or PgBouncer) in front of the database — required, not optional, under a serverless deployment model; see §3A |
| Raw document storage | AWS S3 |
| Secrets | AWS Secrets Manager |
| LLM + embeddings | OpenAI API directly (no AWS involvement) |
| Access control | AWS IAM, scoped to what the app touches, with the actual policy documents attached to the report |
| Logs/metrics | CloudWatch (RDS + S3), plus structured application logs and Sentry for errors — see `assetmind-ai-plan-review.md` §H |
| Backups | RDS automated backups with a PITR window, and one **tested** restore |

This is a smaller AWS footprint than the originally approved flow
(Bedrock and OpenSearch both dropped), but every service still in the
list is doing a specific, necessary job — none of it is there just to
have more AWS in the report.

---

## 8. What changed vs. the earlier docs, and what's still open

**Changed:**
- RAG "pipeline" → agent with a tool registry (Vercel AI SDK tool calling)
- Bedrock → OpenAI API directly for both generation and embeddings
- OpenSearch → dropped; Postgres full-text search covers hybrid retrieval
  alongside pgvector, so structured data, vectors, and keyword search are
  all one database
- Retrieval-variant ladder → tool-availability ladder (same RQs)
- Guardrail rules restated as the **compound** UCI conditions with the RNF
  non-determinism called out, rather than a single threshold per failure
  mode (§3.2)
- Data model gained `SensorReading`; `DocumentChunk` gained embedding and
  chunker version columns (§3A)

**Unchanged:**
- Data model core (Asset, Component, FaultRecord, MaintenanceLog, Document,
  DocumentChunk, Chat, ChatMessage)
- The AI4I-2020 rule-based guardrail approach from the previous session
- Dashboard/investigation-UI design
- Evaluation metrics and methodology

**Still open:**
- Whether `DocumentChunk` needs a dedicated tsvector column with a GIN
  index (yes, this is a small, worthwhile schema addition when you build
  the keyword-search tool) — flagging so it's not forgotten, not asking
  you to decide anything new here
- Whether reranking is worth building at all, or only if Phase 6's
  results show raw hybrid retrieval underperforming

**Added by the senior review** (`assetmind-ai-plan-review.md`): the five
research questions stated explicitly (§3.1), agent runtime requirements —
versioned system prompt, citation format, `ToolOutcome` error contract,
per-turn budgets, context caps, citation verification (§3.3), the single
parameterised tool registry shared by eval harness and UI (§3.4), and the
data-layer decisions that serverless deployment forces — driver adapter,
pooler, embedding versioning, index choice, pagination, typed evidence
schema (§3A). Also a testing and CI story, a security story (rate limiting,
prompt injection via ingested documents), accessibility, observability, and
the academic deliverables (related work, threat to validity, artefact
statement). Fourteen items need team sign-off; see that document's §J.
