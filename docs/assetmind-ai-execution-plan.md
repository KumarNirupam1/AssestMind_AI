# AssetMind AI — Execution Plan (revised: agent architecture)

Same phase structure as before, rewritten where the agent/tool framing
and the AWS/Inngest decisions actually change what gets built in each
phase. See `assetmind-ai-architecture.md` for the full reasoning behind
these choices, and `assetmind-ai-plan-review.md` for the senior review
that produced the P0/P1/P2 additions folded into the phases below.

> **Read `assetmind-ai-plan-review.md` before starting Phase 1.** Seven items
> in its §A are blocking gaps in the original plan — the research questions
> were never written down, the data model had nowhere to put sensor
> readings, the guardrail rules were stated as single thresholds when the
> dataset defines them as compound conditions, units were unstated, the demo
> asset ("Pump-102") contradicts the dataset, and there was no test or CI
> story.

---

## Phase 0 — Finalize before writing app code

| Decision | Outcome to lock in |
|---|---|
| Sensor dataset | AI4I 2020 Predictive Maintenance Dataset (already decided) |
| Synthetic asset catalog | 5–10 named assets |
| **Asset naming vs. dataset domain** | AI4I describes a **simulated milling machine** — no pumps. Name assets accordingly, or state the abstraction and argue it. See review §A5 / §J1 |
| Manuals/SOPs source | Real public docs + synthesized ones, clearly flagged |
| **Tool registry** | The 6 tools from the architecture doc — confirm this is the full set, or trim/add before building |
| **Guardrail rules** | The 5 AI4I-2020 rules implemented as the **compound** UCI conditions; RNF's non-determinism explicitly acknowledged. No ML training. See architecture §3.2 |
| **Research questions** | RQ1–RQ5 confirmed as stated in architecture §3.1 — the query set and metrics follow from them |
| **Background jobs** | Inngest (see architecture doc §5) |
| **AWS services** | S3 + RDS/Aurora Postgres+pgvector + Secrets Manager + IAM + CloudWatch (Bedrock and OpenSearch dropped) |
| **Auth provider** | Auth.js v5 beta vs `next-auth@4` vs third-party — decided and recorded (review §J2) |
| **Model + eval protocol** | Pinned model versions, temperature, repeat count N, groundedness rubric, judging method (review §B1) |
| Evaluation plan | Query set size, ground truth ownership, grading method |
| Team roles | Split across Kumar / Moon Rathi / Dristy Pal |
| **Process** | Branching model, definition of done, risk register, ADR log started (review §I) |

**Deliverable:** decisions written down, agreed by all three, plus a risk
register and a started `docs/adr/` log.

---

## Phase 1 — Foundation (weeks 1–2)

- Next.js app scaffolded (App Router, TypeScript, Tailwind) — **note: this
  is Next.js 16, not 15.** Turbopack by default, `params`/`searchParams`
  are Promises, `middleware.ts` is now `proxy.ts`, `next lint` is removed.
  Read `node_modules/next/dist/docs/` rather than working from memory.
- Postgres + pgvector running locally (Docker Compose), matching what
  RDS/Aurora will run in production, with a deliberately small
  `max_connections` so pooling problems surface locally
- Prisma via `@prisma/adapter-pg` (pooling explicit), pinned to the v7
  stable line — `npm i prisma@7`, not `latest`, which currently resolves to
  an 8.x release candidate
- Prisma schema in place: the 8 core models **plus `SensorReading`**
  (architecture §3A), with the dataset's failure-mode flags stored as
  ground-truth columns
- `tsvector` column + GIN index on `DocumentChunk`, plus embedding/chunker
  version columns and a re-index script. Prisma cannot express `vector` or
  `tsvector`, so use `migrate dev --create-only` and hand-edit the SQL —
  do this on day one, retrofitting an extension column after seeding 10k
  rows is miserable
- Indexes on foreign keys and `(assetId, occurredAt)`; cursor pagination
  designed into the dashboard list queries
- `.env.example`, least-privilege local DB user
- `typecheck` script added; Vitest configured; GitHub Actions running
  `lint → typecheck → unit tests → prisma migrate diff → next build`
- Auth working (provider per Phase 0)
- Dashboard reading real seeded data via Server Components — no agent
  involved yet, and **no React Query in the read path** (review §J14)
- Synthetic asset catalog seeded with a **fixed RNG seed** so re-seeding
  is reproducible

**Done when:** you can log in and see real asset/fault/maintenance data on
the dashboard; `npm run typecheck`, `npm test`, and `next build` all pass
in CI on a fresh clone; the schema contains a working vector column, a
working tsvector column, and `SensorReading`.

---

## Phase 2 — Guardrail rule engine (weeks 2–3, parallel with Phase 1)

Not a trained model — the AI4I-2020 rules re-implemented as plain
functions, using the **compound** conditions from architecture §3.2:

- Heat Dissipation, Power, Overstrain, Tool Wear checks as compound
  predicates; Random Failure handled honestly as non-deterministic (excluded
  and documented, or seeded and reported — never faked as a threshold)
- Store and display Kelvin and °C deliberately (architecture §3.2)
- Each rule returns `{ tripped, rule, evidence: { observed, threshold } }` —
  that shape becomes the agent's tool output and the eval data
- **Table-driven unit tests over the full AI4I CSV**, including boundary
  cases (8.6 K exactly, 1380 rpm exactly, 3500 W / 9000 W exactly), because
  `<` vs `<=` is exactly what a panel probes
- **Report the agreement score** between the rule engine and the dataset's
  own `Machine failure` / mode labels across all 10,000 rows
- Wrapped as the `checkGuardrails` tool payload, callable by the agent
- Mapped onto the synthetic asset catalog so a "fault" in the app traces
  back to a real, documented rule tripping on real (synthetic) readings

**Done when:** for any synthetic asset, `checkGuardrails` returns a real
rule-based status backed by actual data, not a fabricated flag; the
agreement score against dataset labels is measured and written down; the
test suite passes including all boundary cases.

---

## Phase 3 — Ingestion pipeline via Inngest (weeks 3–4)

- Manuals/SOPs/fault narratives from Phase 0, uploaded to S3 (behind a
  `DocumentSource` interface so local disk works first — review §J13)
- Inngest function: triggered on upload → parse (unpdf) → chunk → embed
  (OpenAI `text-embedding-3-small`, 1536 dims) → write to `DocumentChunk`
  (vector column, tsvector column, and version columns)
- Use the **same distance operator** on the write and query paths; assert
  embeddings are normalised rather than assuming it
- Exact search, not ANN, for evaluation runs — removes approximation as a
  confound (architecture §3A)
- Ingest documents for every synthetic asset
- `scripts/verify-retrieval.ts`: run one query down the vector path and one
  down the keyword path in raw SQL

**Done when:** every synthetic asset has real, searchable documents behind
it — verified by querying both the vector and keyword paths directly with
`verify-retrieval.ts`, **before the agent is involved**. If keyword search
is broken you want to know now, not in Phase 6.

---

## Phase 4 — Agent + tools (weeks 4–7)

This replaces the old "build the RAG variant ladder" phase.

- Implement all 6 tools as Vercel AI SDK `tool()` definitions with Zod
  schemas (AI SDK is on v7 — read the v7 docs, the `tool()` and `useChat`
  APIs differ from earlier versions)
- Every tool returns the `ToolOutcome` contract — `ok: false` with a typed
  error code instead of throwing, so the model can see and adapt to failure
  (architecture §3.3)
- Versioned system prompt (`lib/agent/prompts.ts`) with the grounding
  obligation, the machine-checkable citation format, an abstention
  instruction, and per-tool *guidance* rather than a mandated order
- `buildToolRegistry(names)` + a `TOOL_CONFIGS` const enumerating configs
  1–5 as **subsets of the one registry** (architecture §3.4). Both the eval
  harness and the UI selector call this same function, so demo and
  experiment cannot drift
- Build the agent loop in `app/api/chat/route.ts` (`streamText` with
  `tools` + `maxSteps`), with per-turn resource limits: step ceiling, token
  budget, per-tool timeout with one retry, per-user daily quota
- Per-tool result caps and a total evidence budget, documented as a known
  confound (config 5 carries more context than config 1)
- Log every tool call + result into `ChatMessage.evidence` as it happens,
  through a **versioned Zod schema validated on read**
- Capture token usage and duration per turn
- Citation verifier: extract every `[...]` citation from an answer, confirm
  the id exists in that turn's evidence, flag uncited factual sentences
- Integration test per tool against the seeded DB; one end-to-end smoke
  test posting to `/api/chat`

**Done when:** you can register just tool subset 1 (none), run a query, get
a baseline answer; register subset 5 (all tools), run the same query, see
the agent actually choose to call some of them and produce a grounded answer
with a real evidence trail; the same registry function serves both the
harness and the UI; a deliberately failing tool returns `ok: false` and the
agent recovers rather than the stream dying.

---

## Phase 5 — Investigation chat UI (weeks 5–8, parallel with Phase 4)

- Chat interface via `useChat`, streaming
- Evidence panel rendering the tool-call trace from `ChatMessage.evidence`
  — show which tools were called and what they returned, not just the
  final chunks — and **filling in live as calls arrive**, which is the most
  persuasive thing the demo can show
- Tool-config selector wired to the shared registry, so config differences
  can be demonstrated live (review §C7)
- "Investigate" entry point from an asset's detail page
- Chat history persistence, incremental so a mid-stream disconnect does not
  punch a hole in the eval data
- `loading.tsx` / `error.tsx` / `not-found.tsx` boundaries and designed
  empty, error, and dropped-stream states
- Accessibility: keyboard navigation through the evidence panel, focus
  management on stream completion, ARIA live regions for streaming text,
  WCAG AA contrast
- Per-user rate limiting and token quota enforced server-side
- Responsive spec for the chat + evidence panel layout

**Done when:** an engineer-role user can ask a question and see both the
streamed answer and a legible, live trace of what the agent actually did;
a dropped stream recovers visibly rather than silently; the flow is
keyboard-navigable.

---

## Phase 6 — Evaluation (weeks 8–10)

- Finalize query set + ground truth. State N, authorship, and who adjudicates
  disagreements. Include a held-out set, or report development-set results
  as such
- Pin exact model versions (not aliases), temperature, max tokens, and
  `maxSteps`; record them plus `SYSTEM_PROMPT_VERSION` and the **git commit
  SHA** in every run's metadata
- Run every query through tool-subset configs 1–5, **N ≥ 3 repeats per
  cell**, reporting mean ± spread — LLM output is nondeterministic and a
  single run per cell cannot support a comparison table
- For each: log which tools were called (not just assume config = usage —
  the agent might skip an available tool, which is itself a finding),
  retrieval recall@k against hand-labelled relevant chunks, groundedness /
  unsupported-claim rate against a **written per-claim rubric**, latency,
  token cost
- LLM-as-judge for scale, **human-graded 20% sample, report agreement**.
  Unvalidated judge numbers are not defensible
- Include at least one prompt-injection case and report how the agent
  handled untrusted document content
- Analyze against RQ1–RQ5 (architecture §3.1)
- Write the threat-to-validity section (construct, internal, external,
  conclusion) and a **negative results / failure analysis** section
- Commit machine-readable output (JSON/CSV); the results table must be
  regenerable by one command

**Done when:** results table comparing all 5 configs, including *which
tools the agent actually chose to use* at each config, means and spreads
over repeats, and agreement statistics for the judge — regenerable from a
committed script, with threat-to-validity and negative results written up.

---

## Phase 7 — Deployment (weeks 9–10, parallel with Phase 6)

- App on Vercel
- Postgres on RDS or Aurora Serverless v2, pgvector enabled, schema
  migrated
- **RDS Proxy or PgBouncer in front of the database** — required under a
  serverless model, and the failure mode without it is invisible locally
  (architecture §3A)
- Raw documents moved to S3, ingestion re-run against production data
- Secrets in Secrets Manager, IAM scoped appropriately, actual policy
  documents attached to the report
- Inngest pointed at the deployed app
- Health check endpoint verifying DB reachability; Sentry wired up;
  structured JSON logs with a per-turn correlation ID propagated into every
  tool call
- RDS automated backups configured and **one restore tested**
- Runbook written: deploy, migrate, re-seed, re-ingest, re-run eval, and
  what to do when the DB is out of connections

**Done when:** the deployed app behaves identically to local dev, including
background ingestion; the health check is green; a restore has been
performed successfully at least once.

---

## Phase 8 — Report + research paper (weeks 10–12)

Same structure as before. Additional things to write up given the agent
framing:

- Explicitly describe the system as an agent with a tool registry, not a
  fixed pipeline — this is a stronger, more current framing for the
  paper's contribution
- Report which tools the agent chose to call per configuration, not just
  which were available — that's a finding in itself (does the agent use
  the guardrail tool appropriately, or lean on it even when the signal is
  weak — this is literally RQ3)
- Note the AWS simplification (no Bedrock, no OpenSearch) as a deliberate
  engineering decision, with reasoning
- **Related work** — 15–20 papers in four groups, stating what each does not
  do that this project does
- **Threat to validity** and **negative results**, per Phase 6
- The guardrail rule engine's **validation score** against dataset labels
  (Phase 2) as a correctness claim
- Data protection statement: no PII, synthetic data, and what is sent to
  OpenAI (user question text, retrieved chunk text)
- Artefact/reproducibility statement: prompts, tool definitions, seed
  scripts, and eval scripts at a named commit; results table regenerates
  via one command
- The ADR log as an engineering-decisions appendix
- **Domain-expert review**: one mechanical-engineering faculty member has
  sanity-checked that fault narratives and maintenance procedures are
  physically plausible, and is acknowledged
- Fault taxonomy aligned to a recognised condition-monitoring vocabulary
  (OSA-C / ISO 13374) where it fits

**Done when:** report and paper draft exist in the agreed venue template,
every claim traces to something measured in Phase 6, and a domain expert
has reviewed the technical content.

---

## Phase 9 — Submission prep (final week)

- Demo script: the asset scenario, narrated as "watch the agent decide
  which tools to call" rather than "watch the pipeline run" — and use the
  tool-config selector to answer the same question twice with visibly
  different tool use
- Record a demo video and keep backup screenshots, so a projector or network
  failure does not end the presentation
- Polish UI/UX
- Rehearse explaining tool-selection behavior — this is what will
  distinguish this from a generic RAG-chatbot demo in front of faculty
  Confirm authorship order and who presents, agreed in advance

**Done when:** the demo runs unattended from a recording if it must, and
the tool-selection explanation has been rehearsed against a recorded run of
the actual app.

---

## Running throughout (not a phase)

- **CI on every PR**: lint, typecheck, unit tests, schema drift, build
- **Risk register** maintained, reviewed at each phase boundary
- **ADR log** written at the time decisions are made, not reconstructed later
- **Definition of done** enforced: tests pass, evidence logged, migration
  committed, docs updated
- **Eval regression golden set** in CI, so a prompt or tool-description
  edit that breaks tool selection is caught before it invalidates a
  recorded Phase 6 run

---

## What changed from the previous plan

- Phase 4 (was: build 5 RAG pipeline variants) → build one agent with 6
  tools, run it with different tool subsets
- Phase 3 now explicitly uses Inngest instead of a synchronous route
- New: tsvector/GIN index addition in Phase 1 for keyword search
- Phase 7's AWS list shrinks (no Bedrock, no OpenSearch) and gains
  specificity (RDS/Aurora, S3, Secrets Manager, IAM, CloudWatch)
- Everything else (dataset, guardrail rules, dashboard, evaluation
  metrics, team roles, risks) is unchanged
- **Added by the senior review** (`assetmind-ai-plan-review.md`):
  - Stated RQ1–RQ5 explicitly; they were referenced but never written down
  - `SensorReading` in the data model — the guardrail tool had no input
  - Guardrail rules restated as compound UCI conditions, with RNF's
    non-determinism and the Kelvin/°C convention made explicit
  - `SensorReading` + ground-truth failure-mode columns
  - Agent runtime: versioned system prompt, citation contract, `ToolOutcome`
    error contract, per-turn budgets, context caps, citation verifier
  - One parameterised tool registry shared by eval harness and demo UI
  - Data layer: driver adapter + pooler, embedding/chunker versioning, index
    and distance-operator choice, indexes, pagination, typed evidence schema
  - Testing and CI, previously absent entirely
  - Security: rate limiting, prompt injection via ingested documents, real
    IAM policy documents
  - Accessibility, error/loading/empty states, live-updating evidence panel
  - Observability: correlation IDs, error tracking, health check, tested
    restore, runbook
  - Academic deliverables: related work, threat to validity, negative
    results, artefact statement, venue/format, authorship, domain-expert
    review
  - Process: risk register, branching + definition of done, ADR log
  - Flagged the unresolved mismatch between the "Pump-102" demo asset and
    the milling-machine dataset

