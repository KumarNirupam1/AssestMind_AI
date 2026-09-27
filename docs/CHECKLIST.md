# AssetMind AI — delivery checklist

Status legend: `[x]` done and verified · `[~]` in progress · `[ ]` not started
Last updated after the Phase 2 rules audit (guardrail rules verified against
the dataset label columns; see `docs/adr/0002-ai4i-guardrail-rules.md`).

Verification is meant to be mechanical wherever possible. A box is only `[x]`
if a command produced the result, not because something "should" work.

---

## Phase 0 — Finalize before writing app code

- [x] Architecture, execution plan and plan review written and versioned under `docs/`
- [x] Project rules consolidated in `AGENTS.md`; migration safety rules recorded
- [x] AI4I dataset downloaded, provenance + CC BY-NC-SA licence documented
- [x] Dataset bytes pinned so a clone reproduces the documented SHA-256
- [x] Final asset naming decided — `PUMP-101`…`PUMP-401`, abstraction stated and argued in `docs/adr/0001-asset-naming.md`
- [ ] Evaluation protocol written down **before** implementation, to avoid
      retrofitting metrics — tracked in **Phase 6A**
- [ ] Final tool registry / action set agreed
- [ ] Manual / SOP source list collected
- [ ] Role authorization model decided (single user vs supervisor/engineer)
- [x] Risk register and ADR log started — `0001-asset-naming`,
      `0002-ai4i-guardrail-rules`

## Phase 1 — Foundation

- [x] Next.js 16 + TypeScript + Tailwind 4 scaffold, clean `tsc --noEmit`
- [x] Prisma 9-model schema applied to the database
- [x] pgvector extension, `vector(1536)`, generated `searchVector`, GIN index verified
- [x] Deterministic AI4I seed script (`npx prisma db seed`)
- [x] `.env.example` committed, `.env` ignored
- [x] Clerk installed, `proxy.ts` route matcher wired
- [x] `(auth)` / `(root)` route groups, protected layout
- [x] Fleet dashboard and asset detail pages (Server Components, direct Prisma, keyset pagination)
- [x] `tailwind-merge` and `clsx` declared explicitly
- [x] Database verification script (`scripts/verify-db.mjs`)
- [x] Vitest configured and a `test` script added
- [x] Unit tests for display helpers and the Kelvin/Celsius conversion
- [ ] Unit tests for guardrail thresholds and CSV parsing
- [x] CI workflow: lint, typecheck, test, build (`.github/workflows/ci.yml`)
- [ ] CI migration-drift gate (blocked on the `searchVector` false positive — see below)
- [ ] Chunk re-index script for when embeddings change
- [ ] Least-privilege application database user (not the Neon owner)
- [x] Manual sign-up → sign-in → dashboard walkthrough on Windows
- [x] Dashboard numbers eyeballed against the seeded dataset (faults, modes, unresolved and mean torque/wear all reconcile with the source)

### Known blockers

- ~~Clerk instance unclaimed~~ — **resolved.** The instance is claimed and
  sign-up → sign-in → dashboard was walked through in a browser.
- ~~No query path executed at runtime~~ — **resolved.** The dashboard and
  asset detail pages render live Prisma data; the user verified the numbers
  against the seeded dataset. Reset, re-seed and `scripts/verify-db.mjs` all
  pass. (The sandbox still cannot reach the DB, so re-verification is a
  Windows-side command.)
- `prisma migrate diff` reports `searchVector` / `DocumentChunk_searchVector_idx`
  as drift because Prisma cannot model a generated `tsvector`. CI must either drop
  the diff step or filter those two statements.
- Neon credential appeared in an earlier transcript and must be rotated.
- No Git remote, so CI has never actually executed.

## Phase 2 — Guardrail rule engine

**Rules verified against `ai4i2020.csv` label columns before any engine code
was written.** `npm run verify:rules` (11 checks, all passing) is the gate,
and it runs in CI. Full reasoning in
`docs/adr/0002-ai4i-guardrail-rules.md`.

- [x] HDF rule verified — `abs(processTemp − airTemp) < 8.6` **AND**
      `rotationalSpeed < 1380` reproduces all 115 label rows exactly
- [x] PWF rule verified — `power = torque × 2π × speed / 60`, fail outside
      3500–9000 W, reproduces all 95 label rows exactly
- [x] OSF rule verified — `toolWear × torque > 11000` (L) / `12000` (M) /
      `13000` (H), reproduces all 98 label rows exactly
- [x] "1413 rule" debunked and removed — it is a speed value, not a limit
- [x] TWF and RNF established as **irreducible** (random, not thresholded);
      RQ3 scoped to the three deterministic modes
- [x] Unattributed-failure residue pinned at 9 rows
- [x] Threshold config validated by Zod at the boundary
- [x] HDF/PWF/OSF implemented as pure functions returning structured verdicts
      (`features/guardrails/rules.ts`)
- [x] Verdict records mode, thresholds applied, observed values, and per-clause
      detail — RQ3 can be re-scored from stored evidence
- [x] Compound-condition boundary tests (HDF needs **both** clauses; OSF
      per-type limits; PWF at exactly 3500 W and 9000 W; all limits exclusive)
- [x] Negative test: no rule may "predict" TWF or RNF
- [x] **Engine verified against the dataset** — `rules.dataset.test.ts` runs all
      10,000 rows and asserts zero disagreements with the HDF/PWF/OSF label
      columns, so the shipped code cannot drift from the verified formulas
- [ ] CSV parsing unit tests (BOM handling, `Torque` as float) — belong with
      the Phase 3 ingestion parser

## Phase 3 — Ingestion pipeline

- [ ] Inngest function registered and observable
- [ ] Manual upload path
- [ ] Parser: CSV and PDF, with AI4I column mapping
- [ ] Chunking with citation-preserving provenance
- [ ] Embedding job populates `DocumentChunk.embedding`
- [ ] Idempotent re-runs

## Phase 4 — Agent + tools

- [ ] Tool registry with Zod-validated inputs
- [ ] Sensor-history query tool
- [ ] Maintenance-record lookup tool
- [ ] Retrieval tool using the existing GIN index
- [ ] Guardrail tool backed by Phase 2 (HDF/PWF/OSF only)
- [ ] Agent prompt constrained to cite evidence
- [ ] Tool-call traces persisted for evaluation
- [ ] Step ceiling via `stopWhen: isStepCount(n)`; per-turn token budget,
      per-tool timeout with one retry, per-user daily quota
- [ ] Phase 6A protocol confirmed frozen before this phase is tuned

## Phase 5 — Investigation chat UI

- [ ] Streaming chat route
- [ ] Tool-call rendering
- [ ] Citation display
- [ ] Guardrail verdict surfaced in the transcript
- [ ] History view reusing the sidebar patterns from Phase 1

## Phase 6A — Freeze the evaluation protocol (BEFORE the agent)

Nothing in Phase 4 or 5 may be tuned once this is frozen. The point is that
the protocol predates the implementation, so the numbers cannot be fitted.

- [ ] Labelled question set built from the seed, with gold evidence IDs
- [ ] The five tool-subset configs fixed (baseline / retrieval ablations /
      structured-delta / full)
- [ ] Metrics defined for RQ1–RQ5, including which are **not** meaningful
      (per-mode TWF/RNF recall — see ADR 0002)
- [ ] Groundedness and citation-accuracy scoring procedure agreed
- [ ] N repeats per question and the variance reporting decided
- [ ] Cost and latency measurement method (log `usage` **and**
      `finalStep.usage` separately — v7 semantics)
- [ ] Tool-call success/failure taxonomy fixed
- [ ] Citation verifier implemented as a script
- [ ] Protocol committed and dated; later changes require a new ADR

## Phase 6B — Execute the evaluation

- [ ] Retrieval metrics (recall@k, MRR, nDCG)
- [ ] Answer faithfulness and citation-accuracy scores
- [ ] Guardrail precision / recall / F1 for HDF, PWF, OSF only
- [ ] Latency and token/cost measurements per config
- [ ] Baseline comparison across the five configs
- [ ] Results written to `docs/`
- [ ] Claim-by-claim traceability audit for RQ5

## Phase 7 — Deployment

- [ ] Vercel deployment, environment variables set
- [ ] Inngest production keys
- [ ] Neon is a temporary store; migrate to the teammate's RDS/Aurora
- [ ] RDS certificate / SSL mode documented (`pg` warns about `require` vs `verify-full`)
- [ ] Backup and re-index procedure documented

## Phase 8 — Report + research paper

- [ ] Method section
- [ ] System architecture figures
- [ ] Results tables from Phase 6
- [ ] Limitations, including the AI4I label noise and exact-scan retrieval
- [ ] Cite Matzka 2020, DOI `10.1109/AI4I49448.2020.00023`
- [ ] **No performance or accuracy claims before Phase 6 numbers exist**

## Phase 9 — Submission prep

- [ ] Reproduction instructions from a clean clone
- [ ] Demo script
- [ ] Repository hygiene pass
- [ ] Supervisor review

## Running throughout

- [x] Migration safety: hand-authored SQL, never `prisma migrate dev`
- [x] Dataset provenance and licence recorded, and dataset bytes pinned so a
      clone reproduces the documented SHA-256
- [x] Typecheck clean
- [x] Lint clean across the whole project
- [x] Unit tests run and passing
- [x] Production build passing
- [ ] Tests in CI before the next phase lands

## Known deviations

- `react-hooks/set-state-in-effect` is disabled for `components/ui/**` and
  `hooks/**`. Those files are shadcn-generated; two of them synchronise
  external state with `useEffect` + `setState`. Rewriting them locally would
  be undone by the next `shadcn add`, so the rule is scoped off for the
  vendored paths. `app/` and `features/` are still held to it.
- `@types/node` is on 22 rather than 20, because vitest 5 requires
  `^22 || >=24`. This matches the Node 22 runtime.
- Dataset integrity depends on `.gitattributes` marking `data/raw/*.csv` as
  `-text`. Without it git rewrote CRLF to LF and the committed blob no longer
  matched the checksum in `data/README.md`.
