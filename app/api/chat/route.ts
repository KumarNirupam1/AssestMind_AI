import { openai } from "@ai-sdk/openai";
import { auth } from "@clerk/nextjs/server";
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";

import { resolveEmbeddingProvider } from "@/features/ingestion/embedding.ts";
import {
  EVAL_MODEL,
  EVAL_TEMPERATURE,
  TOOL_CONFIG_KEYS,
  TOOL_CONFIGS_FROZEN,
  type ToolConfigKey,
} from "@/features/evaluation/question-set.ts";
import { prisma } from "@/lib/db";
import { getSystemPrompt, SYSTEM_PROMPT_VERSION } from "@/lib/agent/prompts";
import { MAX_TURN_OUTPUT_TOKENS, STEP_CEILING } from "@/lib/agent/limits";
import { createTurnCollectors } from "@/lib/agent/runtime";
import type { ToolRuntime } from "@/lib/agent/runtime";
import { reserveTurnBudget, createPrismaUsageStore } from "@/lib/agent/quota";
import { createPrismaToolDb } from "@/lib/agent/tool-db";
import { buildToolRegistry } from "@/lib/agent/registry";
import {
  loadChatMessages,
  saveAssistantTurn,
  saveUserMessage,
  toUIMessages,
} from "@/lib/agent/chat-store";

/**
 * POST /api/chat — the agent loop.
 *
 * One streamText call per user turn with
 *   - the FROZEN model + temperature (protocol pins both);
 *   - the versioned system prompt (held constant across configs 1-5);
 *   - a tool subset from `TOOL_CONFIGS_FROZEN`, chosen via buildToolRegistry,
 *     so the UI selector and the eval harness share one code path;
 *   - `stopWhen: isStepCount(STEP_CEILING)` as the multi-step ceiling;
 *   - per-user daily token quota reserved before the model is touched.
 *
 * The turn's tool-call records and the citable evidence accumulate in the
 * collectors and are persisted to `ChatMessage.evidence` when the stream
 * finishes — both the UI's evidence panel and the Phase 6B citation verifier
 * read from that same column.
 */

const DEFAULT_CONFIG: ToolConfigKey = 5;

// Durable per-user daily quota ledger, shared across serverless instances
// (Phase 7). The in-memory `defaultUsageStore` stays for local dev and tests.
const usageStore = createPrismaUsageStore(prisma);

function parseConfig(value: unknown): ToolConfigKey {
  return TOOL_CONFIG_KEYS.includes(value as ToolConfigKey) ? (value as ToolConfigKey) : DEFAULT_CONFIG;
}

export async function POST(req: Request) {
  const { userId } = await auth.protect();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  let body: { chatId?: string; message?: UIMessage; config?: number };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const chatId = body?.chatId;
  const message = body?.message;
  if (!chatId || !message || !message.id || !Array.isArray(message.parts)) {
    return new Response("Missing chatId or message", { status: 400 });
  }

  const chat = await prisma.chat.findFirst({ where: { id: chatId, clerkUserId: userId } });
  if (!chat) return new Response("Conversation not found", { status: 404 });

  const config = parseConfig(body?.config);

  // Server-side daily quota, reserved before any tokens are spent. The ledger
  // is a durable per-user DailyUsage row, so a serverless cold start cannot
  // reset a user's quota.
  const quota = await reserveTurnBudget(usageStore, `chat:${userId}`);
  if (!quota.allowed) {
    return new Response(quota.message, { status: 429, headers: { "Retry-After": "3600" } });
  }

  const loaded = await loadChatMessages(prisma, chatId);
  await saveUserMessage(prisma, chatId, message);

  const uiMessages = toUIMessages(loaded, message);
  const modelMessages = await convertToModelMessages(uiMessages);

  const collectors = createTurnCollectors();
  const runtime: ToolRuntime = {
    db: createPrismaToolDb(prisma),
    embed: resolveEmbeddingProvider(),
    recordEvidence: collectors.recordEvidence,
    recordToolCall: collectors.recordToolCall,
  };
  const tools = buildToolRegistry(TOOL_CONFIGS_FROZEN[config], runtime);

  const startedAt = Date.now();
  const result = streamText({
    model: openai(EVAL_MODEL),
    temperature: EVAL_TEMPERATURE,
    instructions: getSystemPrompt(),
    messages: modelMessages,
    tools,
    maxOutputTokens: MAX_TURN_OUTPUT_TOKENS,
    stopWhen: isStepCount(STEP_CEILING),
  });

  // The response is produced by the UI-message stream below; consume the
  // underlying stream so usage/finalStep settle for the audit log.
  void (async () => {
    await result.consumeStream();
    const [usage, finalStep] = await Promise.all([result.usage, result.finalStep]);
    console.log(
      `[agent] chat=${chatId} config=${config} prompt=${SYSTEM_PROMPT_VERSION} ` +
        `durationMs=${Date.now() - startedAt} toolCalls=${collectors.toolCalls.length} ` +
        `evidence=${collectors.evidence.length} usage=${JSON.stringify(usage)} ` +
        `finalStepUsage=${JSON.stringify(finalStep?.usage ?? null)} ` +
        `toolCalls=${JSON.stringify(collectors.toolCalls)}`,
    );
  })().catch((err) => console.error("[agent] audit logging failed", err));

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: uiMessages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      onEnd: async ({ messages: finalMessages }) => {
        try {
          await saveAssistantTurn(prisma, chatId, finalMessages, collectors.evidence);
        } catch (err) {
          // Persistence must never kill the stream the client is waiting on.
          console.error("[agent] failed to persist assistant turn", err);
        }
      },
    }),
  });
}