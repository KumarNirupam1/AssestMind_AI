import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { loadedToUIMessages, messageText, toUIMessages } from "@/lib/agent/chat-store";

function textMessage(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] } as UIMessage;
}

describe("chat-store pure helpers", () => {
  it("messageText joins all text parts, ignoring tool parts", () => {
    const message = {
      id: "m1",
      role: "assistant" as const,
      parts: [
        { type: "text", text: "Found " },
        { type: "text", text: "the fault." },
      ],
    } as UIMessage;
    expect(messageText(message)).toBe("Found the fault.");
  });

  it("loadedToUIMessages rebuilds stored rows as text-only UIMessages", () => {
    const ui = loadedToUIMessages([
      { id: "u", role: "user", content: "hi" },
      { id: "a", role: "assistant", content: "hello [chunk:c#1]" },
    ]);
    expect(ui).toHaveLength(2);
    expect(ui[0]).toEqual({ id: "u", role: "user", parts: [{ type: "text", text: "hi" }] });
    expect(ui[1].role).toBe("assistant");
    expect(ui[1].parts[0]).toEqual({ type: "text", text: "hello [chunk:c#1]" });
  });

  it("toUIMessages appends the incoming message but never mutates history", () => {
    const incoming = textMessage("u2", "user", "again");
    const full = toUIMessages([{ id: "a", role: "assistant", content: "ok" }], incoming);
    expect(full.map((m) => m.id)).toEqual(["a", "u2"]);
  });

  it("persists empty assistant content without a text part (citations live on)", () => {
    const ui = loadedToUIMessages([{ id: "x", role: "assistant", content: "guardrail: OSF [guardrail:OSF]" }]);
    expect(messageText(ui[0])).toBe("guardrail: OSF [guardrail:OSF]");
  });
});