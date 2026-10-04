// Phase 6B run engine. Executes the frozen 24x5x3 grid (360 runs) and writes
// an EvalRunsManifest that `npm run verify:citations -- --runs <file>` scores.
//
//   npm run eval:run                      # all 360 runs -> eval/runs/runs-<ts>.json
//   npm run eval:run -- --config 1        # baseline config only (cheap smoke)
//   npm run eval:run -- --only q001       # one question, all configs
//   npm run eval:run -- --out file.json --resume   # continue a partial manifest
//
// Run engine responsibilities (protocol §9): a run whose manifest fails schema
// validation is discarded loudly, never silently re-derived. A provider/network
// failure is not discarded — it is reported and the process exits non-zero with
// the completed runs already written, so `--resume` on the same file retries
// exactly the failed runIds and nothing else.
//
// Frozen either here or imported: model, temperature, repeats, pricing and the
// five configs come from features/evaluation/question-set.ts; the prompt
// (SYSTEM_PROMPT_VERSION) from lib/agent/prompts.ts; per-turn limits from
// lib/agent/limits.ts. The agent is called through the same buildToolRegistry
// entry point as the chat route, so demo and experiment cannot drift.
//
// This script needs `@/` path aliases, so it runs under tsx (not plain node).

import "dotenv/config";

import { openai } from "@ai-sdk/openai";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, dirname, join } from "node:path";
import { argv } from "node:process";
import { generateText, isStepCount } from "ai";

import { resolveEmbeddingProvider } from "@/features/ingestion/embedding.ts";
import {
  EVAL_MODEL,
  EVAL_REPEATS_PER_CONFIG,
  EVAL_TEMPERATURE,
  TOOL_CONFIG_KEYS,
  TOOL_CONFIGS_FROZEN,
  parseQuestionSet,
  type ToolConfigKey,
} from "@/features/evaluation/question-set.ts";
import {
  EVAL_RUN_SCHEMA,
  parseRunManifest,
  type EvalRunsManifest,
} from "@/features/evaluation/run-manifest.ts";
import { buildRunId, usageToSchema } from "@/features/evaluation/runner.ts";
import { prisma } from "@/lib/db";
import { STEP_CEILING, MAX_TURN_OUTPUT_TOKENS } from "@/lib/agent/limits";
import { getSystemPrompt, SYSTEM_PROMPT_VERSION } from "@/lib/agent/prompts";
import { createTurnCollectors } from "@/lib/agent/runtime";
import type { ToolRuntime } from "@/lib/agent/runtime";
import { createPrismaToolDb } from "@/lib/agent/tool-db";
import { buildToolRegistry } from "@/lib/agent/registry";

function readFlag(flag: string, fallback?: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1];
}

function readFlags(flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && argv[i + 1] !== undefined) values.push(argv[i + 1]);
  }
  return values;
}

const DEFAULT_RUNS_DIR = join(process.cwd(), "eval", "runs");

function defaultRunsPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(DEFAULT_RUNS_DIR, `runs-${stamp}.json`);
}

function resolvePath(p: string): string {
  return isAbsolute(p) ? p : join(process.cwd(), p);
}

async function main() {
  const outRaw = readFlag("--out");
  const outPath = outRaw ? resolvePath(outRaw) : defaultRunsPath();
  const questionPath = resolvePath(readFlag("--questions", "eval/labelled-questions.v1.json") ?? "eval/labelled-questions.v1.json");
  const resume = argv.includes("--resume");

  const configFilter = readFlags("--config").map(Number) as ToolConfigKey[];
  for (const c of configFilter) {
    if (!TOOL_CONFIG_KEYS.includes(c)) {
      console.error(`Unknown --config "${c}". Expected one of ${TOOL_CONFIG_KEYS.join(", ")}.`);
      process.exit(1);
    }
  }
  const onlyFilter = readFlags("--only");

  // The agent's vector search embeds the query with the ACTIVE provider. If
  // that provider is the offline deterministic hash, stored real-model vectors
  // are compared against hashes from a different space — the whole RQ1/RQ3
  // measurement is void. Fail loudly rather than produce plausible garbage.
  const embed = resolveEmbeddingProvider();
  if (embed.id !== "text-embedding-3-small" && !argv.includes("--allow-deterministic")) {
    console.error(
      `Active embedding provider is "${embed.id}" but the seeded chunks and the ` +
        `live eval both require "text-embedding-3-small". Set ` +
        `ASSETMIND_EMBED_PROVIDER=openai with OPENAI_API_KEY (and run ` +
        `npm run embed:backfill first). Use --allow-deterministic to force (invalid).`,
    );
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Load the frozen inputs.
  // -------------------------------------------------------------------------
  const { questions } = parseQuestionSet(JSON.parse(readFileSync(questionPath, "utf8")));
  const gitSha = execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  if (gitSha.length < 7) {
    console.error(`Short git SHA "${gitSha}" — cannot stamp the manifest.`);
    process.exit(1);
  }

  const selectedQuestions = onlyFilter.length === 0
    ? questions
    : questions.filter((q) => onlyFilter.includes(q.id));
  if (selectedQuestions.length === 0) {
    console.error(`No questions matched ${onlyFilter.join(", ")}.`);
    process.exit(1);
  }
  const selectedConfigs = configFilter.length === 0 ? [...TOOL_CONFIG_KEYS] : configFilter;

  // -------------------------------------------------------------------------
  // Resume: skip runIds already present in the target manifest.
  // -------------------------------------------------------------------------
  const existing = new Set<string>();
  if (resume) {
    try {
      const prior = parseRunManifest(JSON.parse(readFileSync(outPath, "utf8")));
      for (const run of prior.runs) existing.add(run.runId);
      console.log(`resuming: ${existing.size} already-completed run(s) in ${outPath}\n`);
    } catch {
      console.error(`--resume set but ${outPath} does not parse. Starting fresh.`);
    }
  }

  // -------------------------------------------------------------------------
  // Execute the grid.
  // -------------------------------------------------------------------------
  const runs: EvalRunsManifest["runs"] = [];
  const failures: string[] = [];
  let attempted = 0;

  const expected = selectedQuestions.length * selectedConfigs.length * EVAL_REPEATS_PER_CONFIG;
  console.log(`grid: ${selectedQuestions.length} questions x ${selectedConfigs.length} configs x ${EVAL_REPEATS_PER_CONFIG} repeats`);
  console.log(`model ${EVAL_MODEL} temperature ${EVAL_TEMPERATURE} prompt ${SYSTEM_PROMPT_VERSION} (${gitSha.slice(0, 12)})\n`);

  const db = createPrismaToolDb(prisma);

  for (const config of selectedConfigs) {
    for (const question of selectedQuestions) {
      for (let repeat = 1; repeat <= EVAL_REPEATS_PER_CONFIG; repeat++) {
        const runId = buildRunId(question.id, config, repeat);
        if (existing.has(runId)) continue;

        // Per-turn collectors: the tools record their own evidence and
        // outcome into these as the run executes (boundary + recordEvidence).
        const collectors = createTurnCollectors();
        const runtime: ToolRuntime = {
          db,
          embed,
          recordEvidence: collectors.recordEvidence,
          recordToolCall: collectors.recordToolCall,
        };
        const tools = buildToolRegistry(TOOL_CONFIGS_FROZEN[config], runtime);

        const startedAt = new Date().toISOString();
        const tick = Date.now();
        attempted++;
        try {
          const result = await generateText({
            model: openai(EVAL_MODEL),
            temperature: EVAL_TEMPERATURE,
            instructions: getSystemPrompt(),
            prompt: question.query,
            tools,
            maxOutputTokens: MAX_TURN_OUTPUT_TOKENS,
            stopWhen: isStepCount(STEP_CEILING),
          });

          const run = EVAL_RUN_SCHEMA.parse({
            runId,
            questionId: question.id,
            config,
            systemPromptVersion: SYSTEM_PROMPT_VERSION,
            gitSha,
            startedAt,
            durationMs: Date.now() - tick,
            usage: usageToSchema(result.usage),
            finalStepUsage: result.finalStep?.usage ? usageToSchema(result.finalStep.usage) : null,
            toolCalls: collectors.toolCalls,
            evidence: collectors.evidence,
            answer: result.text,
          });
          runs.push(run);
          console.log(
            `  ok ${runId.padEnd(12)} ${run.durationMs.toString().padStart(6)}ms ` +
              `steps ${result.steps.length}  tokens ${run.usage.totalTokens}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(
            `${runId}: ${msg.length > 200 ? `${msg.slice(0, 197)}...` : msg}`,
          );
          console.error(`  FAIL ${runId}  ${msg.slice(0, 160)}`);
        }
      }
    }
  }

  console.log(`\ncompleted ${runs.length}/${expected} (${attempted} attempted, ${failures.length} failed)`);

  // -------------------------------------------------------------------------
  // Persist only what is valid; then fail loudly if anything failed, so the
  // incomplete manifest is re-run with --resume rather than silently shipped.
  // -------------------------------------------------------------------------
  if (runs.length > 0) {
    const manifest: EvalRunsManifest = {
      schemaVersion: "v1",
      generatedAt: new Date().toISOString(),
      runs,
    };
    parseRunManifest(manifest); // schema self-check, throws loudly
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(manifest, null, 2));
    console.log(`wrote ${runs.length} run(s) to ${outPath}`);
    console.log(`\nscore with: npm run verify:citations -- --runs ${outPath}`);
  } else {
    console.error(`no runs written to ${outPath}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} run(s) failed; re-run with the same --out and --resume:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("run-eval aborted", err);
  process.exitCode = 1;
});