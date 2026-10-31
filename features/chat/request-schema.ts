import type { UIMessage } from "ai";
import { z } from "zod";

/**
 * Wire contract for POST /api/chat.
 *
 * The browser is untrusted: only user-authored text is accepted. File parts,
 * tool parts and client-supplied roles are rejected, and both part count and
 * total length are capped so a single request cannot bypass the server-side
 * token budget with an oversized payload.
 */

export const MAX_PROMPT_CHARS = 8_000;
export const MAX_PROMPT_PARTS = 20;

const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(MAX_PROMPT_CHARS),
});

export const ChatRequestSchema = z.object({
  chatId: z.string().min(1).max(64),
  config: z.number().int().optional(),
  message: z.object({
    id: z.string().min(1).max(128),
    parts: z.array(TextPartSchema).min(1).max(MAX_PROMPT_PARTS),
  }),
});

export type ParsedChatRequest = {
  chatId: string;
  config: number | undefined;
  /** Sanitised message: role is forced to `user`, parts are text-only. */
  message: UIMessage;
  prompt: string;
};

export type ParseChatRequestResult =
  | { ok: true; value: ParsedChatRequest }
  | { ok: false; error: string };

export function parseChatRequest(input: unknown): ParseChatRequestResult {
  const parsed = ChatRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid chat request" };
  }

  const prompt = parsed.data.message.parts
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (prompt.length === 0) {
    return { ok: false, error: "Message must not be empty" };
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { ok: false, error: `Message exceeds ${MAX_PROMPT_CHARS} characters` };
  }

  return {
    ok: true,
    value: {
      chatId: parsed.data.chatId,
      config: parsed.data.config,
      prompt,
      message: {
        id: parsed.data.message.id,
        role: "user",
        parts: [{ type: "text", text: prompt }],
      },
    },
  };
}
