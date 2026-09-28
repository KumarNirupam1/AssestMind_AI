// Validates eval/labelled-questions.v1.json against the frozen schema and
// checks the structural integrity of the gold evidence (asset/docs names are
// real, fault ids are well-formed, guardrail modes are the deterministic
// three, tool requirements are consistent with the five configs).
//
// Read-only. Usage:
//   npm run verify:questions

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseQuestionSet, TOOL_CONFIGS_FROZEN } from "../features/evaluation/question-set.ts";

const raw = JSON.parse(
  readFileSync(join(process.cwd(), "eval", "labelled-questions.v1.json"), "utf8"),
);

const ASSET_NAMES = new Set([
  "PUMP-101", "PUMP-102", "PUMP-103", "PUMP-201",
  "PUMP-202", "PUMP-301", "PUMP-302", "PUMP-401",
]);
const DOC_TYPES = new Set(["manual", "sop", "fault_narrative", "inspection_report"]);

let set;
try {
  set = parseQuestionSet(raw);
} catch (error) {
  console.error("question set does not parse under the frozen schema:");
  console.error(error);
  process.exit(1);
}

const failures = [];
const check = (ok, name, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

check(set.schemaVersion === "v1", "schema version", set.schemaVersion);
check(set.model === "gpt-4o-mini", "frozen model", set.model);
check(set.temperature === 0, "temperature is zero", `T=${set.temperature}`);
check(set.repeatsPerConfig === 3, "repeats per config", `${set.repeatsPerConfig}`);

console.log(`questions: ${set.questions.length}`);
check(set.questions.length === 24, "question count", `${set.questions.length}`);

const byKind = new Map();
for (const q of set.questions) byKind.set(q.kind, (byKind.get(q.kind) ?? 0) + 1);
for (const k of ["RETRIEVAL", "STRUCTURED", "GUARDRAIL", "MIXED", "WEAK_SIGNAL", "ABSTENTION"]) {
  check(byKind.has(k), `kind ${k} present`, byKind.get(k) ?? 0);
}

console.log();
const ids = new Set();
let badDoc = 0;
let badFault = 0;
let badGuardrail = 0;
let toolNotInSet = 0;
const config5 = TOOL_CONFIGS_FROZEN[5];

for (const q of set.questions) {
  if (ids.has(q.id)) { console.error(`duplicate id ${q.id}`); failures.push(`unique ids`); }
  ids.add(q.id);

  for (const doc of q.gold.docs) {
    const [asset, type] = doc.split("/");
    if (!ASSET_NAMES.has(asset) || !DOC_TYPES.has(type)) badDoc += 1;
  }
  for (const fault of q.gold.faults) {
    if (!/^f-\d{1,5}$/.test(fault)) badFault += 1;
  }
  if (q.gold.guardrail) {
    for (const mode of q.gold.guardrail.modes) {
      if (!["HDF", "PWF", "OSF"].includes(mode)) badGuardrail += 1;
    }
  }
  for (const tool of q.requiresTools) {
    if (!config5.includes(tool)) toolNotInSet += 1;
  }
}
check(badDoc === 0, "gold docs reference real asset/type pairs", `${badDoc} bad`);
check(badFault === 0, "gold fault ids are f-<udi>", `${badFault} bad`);
check(badGuardrail === 0, "guardrail modes are the deterministic three", `${badGuardrail} bad`);
check(toolNotInSet === 0, "required tools exist in config 5", `${toolNotInSet} bad`);

const relevant = set.questions.filter((q) => q.gold.guardrail?.relevant);
const irrelevant = set.questions.filter((q) => q.gold.guardrail && !q.gold.guardrail.relevant);
console.log(`\n  guardrail-relevant: ${relevant.length}, guardrail-irrelevant (weak-signal / over-reliance probes): ${irrelevant.length}`);
check(relevant.length >= 5, "enough guardrail-relevant cases", `${relevant.length}`);
check(irrelevant.length >= 3, "enough weak-signal / over-reliance cases", `${irrelevant.length}`);

console.log();
if (failures.length) {
  console.error(`${failures.length} check(s) failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("Question set is valid and frozen.");