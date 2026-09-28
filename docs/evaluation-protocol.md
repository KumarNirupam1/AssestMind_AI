# Evaluation Protocol — frozen (Phase 6A)

**Status: FROZEN.** Committed on 2026-09-28, before any agent code existed.
Nothing in this document or in `eval/labelled-questions.v1.json` may be tuned
to fit results that have already come in. Changing it afterwards requires a
new ADR (per the execution plan's Phase 6A rule), not an edit.

**Done-condition this phase closed:** the protocol is committed and dated,
the citation verifier runs, the question set parses under a versioned Zod
schema, and every RQ below has a metric that is mechanically computable. No
agent code yet.

---

## 1. System under test

One Next.js app, one agent, one tool registry. Configs are subsets of the
single registry selected by name (`buildToolRegistry`, architecture §3.4);
they are **not** five pipelines. A run is one question through one config
at temperature 0. Model: **`gpt-4o-mini`**. Pricing (USD/MTok, frozen
2026-09-28): input 0.15, output 0.60. System prompt: versioned
(`SYSTEM_PROMPT_VERSION`), held constant across configs, logged per run with
the git SHA.

## 2. The five tool-subset configs

| Config | Name | Tools registered | Primary RQ |
|---|---|---|---|
| 1 | Baseline | none | control for RQ1–RQ4 |
| 2 | Vector retrieval | `searchDocumentsVector` | RQ1 |
| 3 | Hybrid retrieval | `searchDocumentsVector` + `searchDocumentsKeyword` | RQ1 (agent chooses the mix) |
| 4 | Structured delta | 2 + 3 + `getAssetContext`, `getFaultHistory`, `getMaintenanceHistory` | RQ2 |
| 5 | Full system | all six, incl. `checkGuardrails` | RQ3; RQ4/RQ5 evaluate this system |

The exact constant is `TOOL_CONFIGS_FROZEN` in
`features/evaluation/question-set.ts`; the Phase 4 registry and Phase 6B
harness read it from there so demo and experiment cannot drift.

## 3. Question set

`eval/labelled-questions.v1.json` — 24 questions, schema-validated by
`features/evaluation/question-set.ts`. Every question runs through all five
configs, because the baseline behaviour (fabrication on config 1, results
without structure on config 2) is itself the RQ1 measurement.

Coverage:

| Kind | Count | Purpose |
|---|---|---|
| RETRIEVAL | 8 | document-grounded facts, procedures, and the "torque × speed" trap (q023) |
| STRUCTURED | 4 | fault/maintenance history; cross-asset aggregation; temporal correlation |
| GUARDRAIL | 6 | concrete readings, incl. a clean reading and multi-mode rows |
| MIXED | 3 | claims needing both retrieval and structured evidence |
| WEAK_SIGNAL | 2 | TWF (wear-band, rule-cannot-flag) and RNF (no record + not reproducible) |
| ABSTENTION | 1 | fact absent from the corpus — measures baseline fabrication |

Gold evidence is recorded per question as (a) expected documents
(`ASSETNAME/docType`), (b) expected fault records (`f-<udi>`), and (c) the
guardrail expectation (`relevant` + deterministic `modes` + what a grounded
answer should conclude). Gold is used to score RQ3 and to interpret the RQ5
review, **not** to reward/penalise a specific citation string: citations are
validated against the run's own evidence trail, not the gold set.

## 4. Metrics

### RQ1 — Groundedness gain from retrieval
Groundedness for a run = **sentence citation coverage**: share of answer
sentences that carry at least one citation resolving against that turn's
evidence (`sentenceCoverage`, `features/evaluation/metrics.ts`). Report
configs 2, 3, 5 against config 1. Interpret with the context-budget confound
(§7): part of any gain is just more tokens in context.

### RQ2 — Value of structured-data tools
Ablation config 4 vs 3 (adds structured tools) and 5 vs 4 (adds guardrails),
with two axes: grounding (as RQ1) and **evidence composition** — share of
answers citing `[fault:...]` / `[chunk:...]` / `[guardrail:...]`, and the
tool-call mix, to measure whether structured tools substitute for or
complement retrieval.

### RQ3 — Guardrail tool usage
On guardrail-relevant questions (7 in the set): does the agent call
`checkGuardrails`, and does the mode it claims match both the engine verdict
and the gold mode? On guardrail-irrelevant questions (3: q011/q017/q018):
does it call anyway and over-claim (over-reliance), or stay faithful?
**Not a metric:** per-mode precision/recall for TWF and RNF — the modes are
irreproducible coin flips (`docs/adr/0002-ai4i-guardrail-rules.md`), so any
score would measure noise and invite a false-negative finding. Report the
deterministic three (HDF/PWF/OSF) only, and state TWF/RNF as irreducible.

### RQ4 — Cost/latency trade-off
Per run (logged by the harness, not derived): `usage` (all steps) and
`finalStep.usage` (final step) **as two separate series** — AI SDK v7 changed
the meaning of top-level `usage`, and conflating them would corrupt RQ4.
Cost = `costUsd` from the frozen price table. Latency = wall-clock `durationMs`.
Report mean ± SD across the repeat count per config, plus per-question
variance. The cost curve's "flattening" is read from config 1 → 5.

### RQ5 — Traceability
Three outputs, two mechanical and one human:
1. **Citation validity** — every `[chunk:#][fault:][guardrail:]` resolves to
   that turn's evidence (`verifyCitations`). A run with any invalid citation
   fails verification.
2. **Sentence coverage** — as RQ1; the mechanical upper bound on traceability.
3. **Uncited factual claims** — a reviewer pass over every answer
   (8 questions × 5 configs × 3 repeats = 120 answers minimum), flagging
   sentences that assert a fact with no citation. Reported as a rate, not
   folded into the mechanical metric.

## 5. Repeats and variance

3 repeats per question per config (24 × 5 × 3 = **360 runs**). Temperature 0,
so repeats measure residual provider-side variance rather than sampling.
Report mean and SD per config; state the repeat count in the paper.

## 6. Tool-call success/failure taxonomy

`SUCCESS` — tool returned `ok: true`; `NOT_FOUND` — `ok: false` list empty;
`INVALID_INPUT` — schema violation; `TIMEOUT` — exceeded the per-tool timeout
(one retry attempted first); `UPSTREAM` — provider/database error.
Taxonomy is `TOOL_OUTCOME_CODES` in `features/evaluation/run-manifest.ts`.
Report the distribution per config and the recovery rate (share of answers
that continued correctly after an `ok: false`), per architecture §3.3.

## 7. Known confounds, declared (not hidden)

- **Context budget**: config 5 carries far more context than config 1.
  Per-tool result caps and the evidence budget are set centrally; the paper
  states this and keeps the budget constant across configs.
- **Exact-scan retrieval only** — no ANN index, so retrieval quality is
  reproducibility-limited, not index-parameter-limited.
- **Agent chooses tool order** — tool selection is the variable under test;
  per-tool guidance is in the system prompt, no mandated sequence.
- **Document embeds synthetic text** — corpus is the 32 seeded synthetic
  documents/66 chunks; RQ1's retrieval is over synthetic sources, which the
  paper must state as a limitation (synthetic source limitation).
- **The "torque × speed" pitfall is seeded into q023 on purpose** (see ADR;
  torque×speed spans 10,967–99,980 while the rule is power in watts).

## 8. Data-property notes the protocol assumes

These are recorded so the eval is interpreted correctly; they are corpus
facts, not defects:

- **RNF never appears as a FaultRecord.** The dataset flags 19 rows `RNF`,
  but only one also sets `Machine failure=1`, and that row also flags `TWF`,
  so `getFaultHistory` contains no RNF record at all. q017 encodes this.
- **9 of 339 labelled failures carry no per-mode flag** and get no
  FaultRecord (reported by the seed; consistent with TWF replacement events).
- **Multi-mode rows exist** (e.g. UDI 70 = PWF+OSF). RQ3 scores the full
  guardrail verdict, while a FaultRecord names one primary mode.
- **Boundary rows sit exactly on the HDF differential** (8.6 K nominal);
  the rule fires on the true floating-point value, matching the dataset label.
- **Inspection values are seed-derived** (fixed RNG seed), so q015 asks for
  the SOP's interpretation, never a hard-coded figure.

## 9. Reproducibility record per run

The run manifest (`features/evaluation/run-manifest.ts`, versioned and
validated on read) captures per run: `questionId`, `config`,
`systemPromptVersion`, `gitSha`, start time, `durationMs`, `usage` and
`finalStepUsage`, the tool-call log with outcomes, the evidence list, and the
full answer. A run whose manifest fails schema validation is discarded loudly,
never silently re-derived.

## 10. Implementation of this protocol

| Requirement | Where |
|---|---|
| Frozen configs, model, pricing, repeats | `features/evaluation/question-set.ts` |
| Question set (schema version v1) | `eval/labelled-questions.v1.json` |
| Run manifest schema | `features/evaluation/run-manifest.ts` |
| Metric functions | `features/evaluation/metrics.ts` |
| Question-set verifier | `npm run verify:questions` |
| Citation verifier | `npm run verify:citations` (`--runs` to point at a real manifest) |
| Example run | `eval/examples/example-run.json` |