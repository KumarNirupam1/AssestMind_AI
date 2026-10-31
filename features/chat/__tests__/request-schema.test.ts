import { describe, expect, it } from "vitest";

import { MAX_PROMPT_CHARS, parseChatRequest } from "@/features/chat/request-schema";

function request(overrides: Record<string, unknown> = {}) {
  return {
    chatId: "chat_1",
    config: 5,
    message: {
      id: "msg_1",
      role: "user",
      parts: [{ type: "text", text: "  Why did PUMP-101 fail?  " }],
    },
    ...overrides,
  };
}

describe("parseChatRequest", () => {
  it("accepts text-only user messages and trims the prompt", () => {
    const result = parseChatRequest(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prompt).toBe("Why did PUMP-101 fail?");
    expect(result.value.chatId).toBe("chat_1");
    expect(result.value.config).toBe(5);
    expect(result.value.message.role).toBe("user");
    expect(result.value.message.parts).toEqual([
      { type: "text", text: "Why did PUMP-101 fail?" },
    ]);
  });

  it("forces the role to user even when the client claims assistant", () => {
    const body = request();
    (body.message as { role: string }).role = "assistant";
    const result = parseChatRequest(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.message.role).toBe("user");
  });

  it("rejects non-text parts (files, tool output)", () => {
    const result = parseChatRequest(
      request({
        message: {
          id: "msg_1",
          parts: [{ type: "file", mediaType: "image/png", url: "data:..." }],
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects empty and oversized prompts", () => {
    const empty = parseChatRequest(
      request({ message: { id: "m", parts: [{ type: "text", text: "   " }] } }),
    );
    expect(empty.ok).toBe(false);

    const huge = parseChatRequest(
      request({
        message: {
          id: "m",
          parts: [{ type: "text", text: "x".repeat(MAX_PROMPT_CHARS + 1) }],
        },
      }),
    );
    expect(huge.ok).toBe(false);
  });

  it("rejects a missing chat id", () => {
    expect(parseChatRequest(request({ chatId: "" })).ok).toBe(false);
  });
});
