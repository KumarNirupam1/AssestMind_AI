import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const runsDir = `${root}eval/runs`;
const questions = JSON.parse(readFileSync(`${root}eval/labelled-questions.v1.json`, "utf8")).questions;
const realFiles = [
  "real-c4-q001.json",
  "real-c4-q002.json",
  "real-c5-q001.json",
  "real-c5-q002.json",
];
const realRuns = realFiles.flatMap((file) => JSON.parse(readFileSync(`${runsDir}/${file}`, "utf8")).runs);
const realById = new Map(realRuns.map((run) => [run.runId, run]));
const gitSha = execSync("git rev-parse HEAD").toString().trim();
const generatedAt = new Date().toISOString();
const runs = [];

for (const question of questions) {
  for (const config of [1, 2, 3, 4, 5]) {
    for (let repeat = 1; repeat <= 3; repeat++) {
      const runId = `q${question.id.slice(1)}-c${config}-r${repeat}`;
      const real = realById.get(runId);
      if (real) {
        runs.push(real);
        continue;
      }

      runs.push({
        runId,
        questionId: question.id,
        config,
        systemPromptVersion: "v1",
        gitSha,
        startedAt: generatedAt,
        durationMs: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finalStepUsage: null,
        toolCalls: [],
        evidence: [],
        answer: "[MOCK FIXTURE ONLY] No model call was made for this run.",
      });
    }
  }
}

mkdirSync(runsDir, { recursive: true });
writeFileSync(
  `${runsDir}/mixed-test-only.json`,
  JSON.stringify({ schemaVersion: "v1", generatedAt, runs }, null, 2),
);
writeFileSync(
  `${runsDir}/mixed-test-only.metadata.json`,
  JSON.stringify(
    {
      artifactType: "mixed-test-only",
      officialResearchUse: false,
      warning: "This fixture combines real runs with deterministic mock records and must not be used as experimental evidence.",
      realRunCount: realRuns.length,
      mockRunCount: runs.length - realRuns.length,
      realSourceFiles: realFiles,
      mockAnswerPrefix: "[MOCK FIXTURE ONLY]",
      generatedAt,
    },
    null,
    2,
  ),
);
console.log(`wrote ${realRuns.length} real and ${runs.length - realRuns.length} mock runs`);
