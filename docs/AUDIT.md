# Project audit — findings

Audit date: 2026-09-27. Scope: every tracked source file, the docs, the CI
workflow, and the installed dependency set, checked against the
version-matched official documentation for Next.js 16, Prisma 7, Vercel AI SDK
7, Inngest, and OpenAI.

Severity: **P0** blocks a phase or corrupts results · **P1** will cause a
runtime failure or a wrong number · **P2** should be fixed, will not block ·
**P3** note only.

---

## Fixed during this audit

### P1 — `maxSteps` does not exist in AI SDK v7

Every doc specified the agent loop as `streamText`/`generateText` with
`tools` + `maxSteps`. In v7 that option is gone: the ceiling is
`stopWhen: isStepCount(n)`, and the helper `stepCountIs` was renamed to
`isStepCount`. This would have thrown on the first agent request in Phase 4.

Also corrected while in there, all verified against the official v7 migration
guide and the `ai@7.0.60` reference:

- `system:` → `instructions:`
- `onFinish` → `onEnd`
- `result.fullStream` → `result.stream`
- top-level `usage` now covers **all** steps; final-step-only values moved to
  `result.finalStep`. RQ4 cost reporting depends on not conflating them.

Touched: `AGENTS.md`, `docs/assetmind-ai-architecture.md`,
`docs/assetmind-ai-execution-plan.md`, `docs/assetmind-ai-plan-review.md`.

### P1 — the "1413" rule does not exist

`docs/CHECKLIST.md` specified a "TWF torque × speed rule using the AI4I
threshold of 1413". There is no such threshold. `torque × speed` ranges
10,967–99,980 across the dataset, so 1413 cannot bound it; 1413 is simply a
rotational-speed value appearing in 30 rows.

Verified the real rules against the CSV label columns instead — see P0 below.
`scripts/verify-guardrail-rules.mjs` now asserts the debunking so it cannot
silently return.

### P1 — CI would have hit the Prisma 8 RC CLI

`npx prisma` and `npm install prisma` now resolve to the **Prisma 8 RC** CLI,
which does not read `schema.prisma` and has no `generate`, `migrate dev`, or
`db push`. The local `^7.10.0` pin protects `npm run` scripts, but CI used a
bare `npx prisma generate`. Now pinned to `npx prisma@7 generate`, and
`AGENTS.md` documents the trap.

### P0 — three guardrail rules were unverified and two modes are impossible

The Phase 2 rules had been written from prose, not checked against the data.
Measured against `ai4i2020.csv`:

| Mode | Condition | Computed | Label | Verdict |
| --- | --- | --- | --- | --- |
| HDF | `abs(processTemp − airTemp) < 8.6` AND `speed < 1380` | 115 | 115 | exact row-for-row |
| PWF | `torque × 2π × speed / 60`, outside 3500–9000 W | 95 | 95 | exact row-for-row |
| OSF | `toolWear × torque > 11000`/`12000`/`13000` by type L/M/H | 98 | 98 | exact row-for-row |
| TWF | — | — | 46 | **impossible** |
| RNF | — | — | 19 | **impossible** |

Consequences recorded in `docs/adr/0002-ai4i-guardrail-rules.md`:

- OSF's per-type split is load-bearing. A flat `11000` gives 125 rows, not 98.
- PWF needs the `2π/60` conversion; a torque×rpm rule is wrong by construction.
- HDF needs `Math.abs`. Read literally as `airTemp − processTemp < 8.6` the
  condition fires on nearly every row. The abs and signed forms coincide on
  AI4I only because process temperature is always the higher of the two.
- **TWF is not a threshold.** The tool is replaced *or fails* at a randomly
  chosen wear time in 200–240 min. 790 rows sit in that band but only 46 are
  labelled TWF, and 3 TWF rows fall outside it. No function of the inputs
  separates them, so per-mode TWF recall is **not a meaningful metric** and
  reporting it as a model deficiency would be a methodological error.
- **RNF is a 0.1% coin flip**, and the UCI documentation's count (5 rows) is
  wrong — the release contains 19 (0.19%). A documentation error worth
  stating in the paper's limitations.

### P2 — the checklist asserted things that were already resolved

It still listed "Clerk instance unclaimed" and "no query path executed at
runtime" as blockers. Both were fixed and verified. Corrected, with the
real remaining blockers called out.

---

## Confirmed correct

Checked, no action needed — recorded so the next audit does not re-litigate it.

- **`proxy.ts` default export is valid.** The Next 16 guide explicitly allows
  a default export or a named `proxy` export. `clerkMiddleware`'s default
  export is the documented Clerk pattern. The earlier concern was unfounded.
- **`await auth()` / `auth.protect()`** matches the Clerk server-side contract.
- **`lib/db.ts` is sound**: global singleton for HMR, bounded pool
  (`max`, `idleTimeoutMillis`, `connectionTimeoutMillis`), `disposeExternalPool`,
  and `DATABASE_URL` guarded. No connection leak on reload.
- **The generated Prisma client is correctly ignored.** `.gitignore` has
  `/lib/generated/prisma`; nothing under it is tracked. (An earlier check of
  mine tested `lib/generated` rather than `lib/generated/prisma` and reported
  a false positive.)
- **`vector(1536)` is right** for `text-embedding-3-small`, whose default
  output is 1536 dimensions. No `dimensions` parameter needed.
- **The dataset checksum and BOM handling** are correct; the seed's BOM strip
  and float/integer column distinctions are right.
- **Keyset pagination, derived health thresholds, and the 9-row unattributed
  failure residue** all reconcile with the data.

---

## Open risks

### P1 — CI has never run

No Git remote, so the workflow is unexecuted. It is the only thing standing
between the docs and reality for lint/typecheck/test/build. Needs a remote and
one push.

### P1 — Neon credential rotation unconfirmed

The connection string appeared in an earlier transcript. Until it is rotated,
treat the database as exposed.

### P1 — the deployment story is unfinished

Neon is a temporary store. Serverless + RDS exhausts `max_connections` without
a pooler, and `pg` warns that `sslmode=require` aliases `verify-full` — RDS
needs an explicit certificate mode. Both are Phase 7 work and both need the
teammate's infrastructure.

### P2 — Inngest serving details that will bite at deploy time

From the official docs: the App Router needs **three** exports —
`export const { GET, POST, PUT } = serve({...})` from `inngest/next` — not
just a default export. On Vercel, `maxDuration` should be set explicitly
(recommended 300) and, because v4 enables checkpointing by default,
`checkpointing.maxRuntime` should be set to 20–40% below `maxDuration` or
long runs will be killed mid-step.

### P2 — dependencies for Phases 3–5 are not installed yet

`ai`, `@ai-sdk/openai`, `zod`, `inngest`, `@inngest/nextjs`, `openai`,
`@playwright/test`. Deliberately deferred, but the Zod major version must be
chosen against AI SDK v7's expectations when they are added.

### P2 — `next build` warning about a parent `package-lock.json`

Next ignores a lockfile above the repo root (here `C:\Users\hp`). Harmless
locally; can matter for output file tracing on deploy. `turbopack.root` or
`outputFileTracingRoot` if it ever does.

### P2 — seed is not idempotent

`prisma/seed.ts` creates rows rather than upserting, so re-running it against a
populated database duplicates. `scripts/reset-data.sql` is the intended path
and has been used. Worth a guard so a stray `db seed` cannot corrupt the
dataset mid-experiment.

### P3 — Prisma 8 migration path is already clear

Incidentally confirmed: `prisma7.config.ts` is exactly the filename Prisma's
own 7→8 guide recommends, so the future migration will not need a rename. A
Prisma 8 upgrade would require `@@map` on every model, emitting a contract, and
moving the CLI — all out of scope now.

---

## What the audit did not cover

- No CI execution (no remote).
- No database mutation: every claim here is from the CSV, the docs, or
  previously verified runtime output. Re-run `npm run verify:rules` and
  `npm run verify:db` on Windows after any data change.
- RQ1–RQ5 remain unanswerable until 6A is frozen and 6B runs. Nothing in this
  audit is a result.
