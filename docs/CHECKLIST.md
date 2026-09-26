# AssetMind AI — delivery checklist

Status legend: `[x]` done and verified · `[~]` in progress · `[ ]` not started
Last updated after commit `7396ffe`.

Verification is meant to be mechanical wherever possible. A box is only `[x]`
if a command produced the result, not because something "should" work.

---

## Phase 0 — Finalize before writing app code

- [x] Architecture, execution plan and plan review written and versioned under `docs/`
- [x] Project rules consolidated in `AGENTS.md`; migration safety rules recorded
- [x] AI4I dataset downloaded, provenance + CC BY-NC-SA licence documented
- [x] Dataset bytes pinned so a clone reproduces the documented SHA-256
- [ ] Final asset naming decided (`MC-101` is a provisional seed default)
- [ ] Evaluation protocol written down **before** implementation, to avoid retrofitting metrics
- [ ] Final tool registry / action set agreed
- [ ] Manual / SOP source list collected
- [ ] Role authorization model decided (single user vs supervisor/engineer)
- [ ] Risk register and ADR log started

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
- [ ] CI workflow: typecheck, test, lint, build
- [ ] CI migration-drift gate (blocked on the `searchVector` false positive — see below)
- [ ] Chunk re-index script for when embeddings change
- [ ] Least-privilege application database user (not the Neon owner)
- [ ] Manual sign-up → sign-in → dashboard walkthrough on Windows
- [ ] Dashboard numbers eyeballed against the seeded dataset

### Known blockers

- Clerk instance unclaimed, so authenticated screens are unverified in a browser.
- Sandboxed environment cannot reach the database (TCP 5432 blocked), so no query
  path has been executed at runtime. Build, typecheck and route protection are
  verified; data rendering is not.
- `prisma migrate diff` reports `searchVector` / `DocumentChunk_searchVector_idx`
  as drift because Prisma cannot model a generated `tsvector`. CI must either drop
  the diff step or filter those two statements.
- Neon credential appeared in an earlier transcript and must be rotated.

## Phase 2 — Guardrail rule engine

- [ ] Threshold config validated by Zod at the boundary
- [ ] HDF overheat rule (temperature-derived rate of change)
- [ ] TWF torque × speed rule using the AI4I threshold of 1413
- [ ] PWF power anomaly rule
- [ ] OSF spindle-load rule
- [ ] Rules return structured verdicts, not booleans
- [ ] Unit tests per rule, including boundary values

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
- [ ] Guardrail tool backed by Phase 2
- [ ] Agent prompt constrained to cite evidence
- [ ] Tool-call traces persisted for evaluation

## Phase 5 — Investigation chat UI

- [ ] Streaming chat route
- [ ] Tool-call rendering
- [ ] Citation display
- [ ] Guardrail verdict surfaced in the transcript
- [ ] History view reusing the sidebar patterns from Phase 1

## Phase 6 — Evaluation

- [ ] Labelled question set built from the seed
- [ ] Retrieval metrics (recall@k, MRR, nDCG)
- [ ] Answer faithfulness and citation-accuracy scoring
- [ ] Guardrail detection precision / recall / F1
- [ ] Latency measurements
- [ ] Baseline comparison (keyword-only vs hybrid vs reranked)
- [ ] Results written to `docs/`

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
