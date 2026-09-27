# ADR 0002 — AI4I guardrail rules: verified spec and two irreducible modes

- **Status:** Accepted
- **Date:** 2026-09-27
- **Supersedes:** the undocumented `1413` rule referenced in earlier drafts of
  `docs/CHECKLIST.md` and commit `f7ea99a`'s message. **No such rule exists.**

## Context

Phase 2 was going to implement `checkGuardrails` from the rule descriptions
in circulation for AI4I 2020. Before writing the engine, every rule was
checked against the actual `data/raw/ai4i2020.csv` label columns rather than
trusted from prose. Three of the five modes reproduce their labels exactly.
Two cannot be predicted at all, and one widely-repeated rule is a fiction.

The verification script is `scripts/verify-guardrail-rules.mjs`; it is
read-only and touches no database. It is wired into `npm run verify:rules`.

## Decision

### Rules that reproduce the dataset labels exactly

| Mode | Condition | Computed | Label |
| --- | --- | --- | --- |
| HDF | `abs(processTemp − airTemp) < 8.6` **AND** `rotationalSpeed < 1380` | 115 | 115 |
| PWF | `power = torque × 2π × speed / 60`; fail when `power < 3500 W` or `power > 9000 W` | 95 | 95 |
| OSF | `toolWear × torque > 11000` (L) / `> 12000` (M) / `> 13000` (H) | 98 | 98 |

For all three, the *row sets* are identical, not merely the counts.

### Rules that cannot be reproduced

**TWF — 46 labelled rows.** The tool is replaced **or fails** at a randomly
selected tool-wear time between 200 and 240 min; of those 120 events the
tool is replaced 69 times and fails 51 times, randomly assigned. 790 rows
fall inside the 200–240 wear band but only 46 are labelled TWF, and 3 TWF
rows sit outside the band (observed range 198–253). No function of the
process parameters separates the two outcomes.

**RNF — 19 labelled rows.** A per-row 0.1% coin flip. The UCI documentation
claims 5 rows; the released CSV contains 19 (0.19%). The documentation is
wrong here, which is worth stating in the paper's limitations.

### The "1413" rule does not exist

1413 is not a threshold in AI4I. It is a rotational-speed value that happens
to appear in 30 of the 10,000 rows. `torque × speed` ranges 10,967–99,980
across the dataset, so no torque × speed rule can use 1413. The dataset
documentation's only *numbers* are 8.6 K, 1380 rpm, 3500/9000 W, and
11000/12000/13000 min·Nm.

## Consequences

- **RQ3 is scoped to HDF, PWF and OSF.** Per-mode precision/recall for TWF
  and RNF is not a meaningful metric, because no deterministic function of
  the inputs can achieve it. Reporting a low TWF recall as if it were a
  model deficiency would be a methodological error. The paper reports the
  three deterministic modes, and states TWF/RNF as irreducibly random.
- **`Machine failure` is not a rule.** It is `OR` of the five mode flags.
  339 rows have it set; 9 of those have all five mode flags clear, so the
  seed stores 330 attributable faults and keeps those 9 as readings only.
- **OSF needs the product type.** A flat `11000` threshold produces 125
  rows instead of 98. The `L`/`M`/`H` split is load-bearing and is the kind
  of detail that is easy to drop in a refactor.
- **HDF must use the absolute difference.** The spec's "difference between
  air- and process temperature is below 8.6 K" read literally as
  `airTemp − processTemp < 8.6` fires on nearly every row. The abs and
  signed forms coincide on AI4I only because process temperature is always
  the higher of the two.
- Guardrail verdicts stay **structured**, and every verdict records the mode,
  the thresholds applied, and the observed values, so RQ3 can be re-scored
  from stored evidence without re-running the agent.
