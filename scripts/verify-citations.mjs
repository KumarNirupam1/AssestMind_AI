// Mechanical citation verifier (Phase 6A deliverable). Takes a run manifest
// produced by the Phase 6B harness and computes the RQ5 traceability metrics:
//   - citation validity: every [chunk/fault/guardrail:...] resolves to an
//     entry in the turn's evidence with a matching ordinal / mode
//   - sentence coverage: share of answer sentences backed by a valid citation
//   - RQ4 cost per run from the frozen price table, logging usage (all steps)
//     and finalStep.usage (final step) separately
//   - RQ3 and RQ4 aggregations by config
//
// Rejects any run whose answer cites evidence that was not actually part of
// that turn. Usage:
//   npm run verify:citations
//   npm run verify:citations -- --runs eval/examples/example-run.json

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";

import { parseRunManifest } from "../features/evaluation/run-manifest.ts";
import {
  costUsd,
  guardrailUsage,
  parseCitations,
  sentenceCoverage,
  splitSentences,
  toolCallTally,
  verifyCitations,
} from "../features/evaluation/metrics.ts";
import { parseQuestionSet } from "../features/evaluation/question-set.ts";

const arg = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at !== -1 ? argv[at + 1] : fallback;
};

const runsPath = arg("--runs", join("eval", "examples", "example-run.json"));
const questionsPath = arg("--questions", join("eval", "labelled-questions.v1.json"));

const manifest = parseRunManifest(
  JSON.parse(readFileSync(join(process.cwd(), runsPath), "utf8")),
);
const questions = parseQuestionSet(
  JSON.parse(readFileSync(join(process.cwd(), questionsPath), "utf8")),
).questions;
const byQuestionId = new Map(questions.map((q) => [q.id, q]));

console.log(`runs: ${manifest.runs.length}`);
console.log(`questions loaded: ${questions.length}`);
console.log();

const failures = [];
const aggregates = new Map(); // config -> EvalRun[]

for (const run of manifest.runs) {
  const tallies = toolCallTally(run.toolCalls);
  const citations = parseCitations(run.answer);
  const verdict = verifyCitations(citations, run.evidence);
  const sentences = splitSentences(run.answer);
  const coverage = sentenceCoverage(sentences, verdict.valid);
  const usage = guardrailUsage(run.toolCalls, citations);

  const invalidList = verdict.invalid.map((c) => c.raw).join(" ");
  const badge = verdict.invalid.length === 0 ? "PASS" : "FAIL";
  if (verdict.invalid.length > 0) {
    failures.push(`${run.runId}: invalid citations ${invalidList}`);
    console.log(`  ${badge} ${run.runId} ${run.questionId} config ${run.config}`);
    console.log(`        invalid citations: ${invalidList}`);
  } else {
    console.log(`${badge} ${run.runId} ${run.questionId} config ${run.config}`);
  }

  console.log(
    `        validity ${(verdict.validity * 100).toFixed(0)}%  coverage ${(coverage.coverage * 100).toFixed(0)}% ` +
      `(${coverage.covered}/${coverage.total})  cost ${costUsd(run.usage).toFixed(4)} USD ` +
      `duration ${(run.durationMs / 1000).toFixed(1)}s  successRate ${(tallies.successRate * 100).toFixed(0)}%`,
  );

  const question = byQuestionId.get(run.questionId);
  if (question?.gold.guardrail && !question.gold.guardrail.relevant) {
    const status = usage.called ? "GUARDRAIL CALLED ON IRRELEVANT QUESTION" : "abstained from guardrail";
    console.log(`        RQ3: ${status} (${question.id} gold.guardrail.relevant=false)`);
  }

  const byConfig = aggregates.get(run.config) ?? [];
  byConfig.push(run);
  aggregates.set(run.config, byConfig);
}

console.log("\naggregate by config");
console.log("  config  n  validity  coverage  cost(USD)  cost(1 step)  duration(s)  successRate");
const mean = (runs, fn) => runs.reduce((a, r) => a + fn(r), 0) / runs.length;
for (const [config, runs] of [...aggregates.entries()].sort((a, b) => a[0] - b[0])) {
  const n = runs.length;
  const ensemble = (fn) => mean(runs, fn);
  console.log(
    `  ${config}      ${String(n).padStart(3)}  ${(ensemble((r) => verifyCitations(parseCitations(r.answer), r.evidence).validity) * 100).toFixed(1).padStart(7)}%  ` +
      `${(ensemble((r) => sentenceCoverage(splitSentences(r.answer), verifyCitations(parseCitations(r.answer), r.evidence).valid).coverage) * 100).toFixed(1).padStart(8)}%  ` +
      `${ensemble((r) => costUsd(r.usage)).toFixed(4).padStart(8)}  ` +
      `${ensemble((r) => costUsd(r.finalStepUsage ?? r.usage)).toFixed(4).padStart(10)}  ` +
      `${(ensemble((r) => r.durationMs / 1000)).toFixed(1).padStart(8)}  ` +
      `${(ensemble((r) => toolCallTally(r.toolCalls).successRate) * 100).toFixed(0).padStart(9)}%`,
  );
}

console.log("notes");
console.log("  Aggregates are mean per configuration; the within-config variance denominator");
console.log("  is the repeat count (3 per question). RQ4 must report usage (all steps) and");
console.log("  finalStep.usage (final step) as separate series, which the two cost columns do.");

if (failures.length) {
  console.error(`\n${failures.length} run(s) failed citation verification`);
  process.exit(1);
}
console.log("\nAll citations verify.");