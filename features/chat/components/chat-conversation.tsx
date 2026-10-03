"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import * as React from "react";

import { ConfigSelector } from "@/features/chat/components/config-selector";
import { ChatMessages } from "@/features/chat/components/chat-messages";
import { Composer } from "@/features/chat/components/composer";
import type { EvidenceLedger } from "@/features/chat/queries";
import { TOOL_CONFIG_KEYS, type ToolConfigKey } from "@/features/evaluation/question-set.ts";

/**
 * The investigation chat client.
 *
 * Transport contract (matches app/api/chat/route.ts): the server expects a
 * single last message plus an eval config id, so `prepareSendMessagesRequest`
 * sends `{ chatId, message, config }` rather than the whole history. The
 * config is per-send metadata (read only when a send fires), so swapping tool
 * configs mid-conversation never touches the transport — its identity stays
 * stable and the conversation isn't reset.
 */
export function ChatConversation({
  chatId,
  title,
  initialMessages,
  ledger,
}: {
  chatId: string;
  title: string;
  initialMessages: UIMessage[];
  ledger: EvidenceLedger;
}) {
  const defaultConfig = TOOL_CONFIG_KEYS[TOOL_CONFIG_KEYS.length - 1] ?? TOOL_CONFIG_KEYS[0];
  const [config, setConfig] = React.useState<ToolConfigKey>(defaultConfig);

  // Stable transport, created once — a new transport identity would reset the
  // conversation. The eval config is NOT captured here; it rides along on each
  // send via `sendMessage` metadata, so changing the selector mid-conversation
  // affects the next turn without ever touching this object.
  const [transport] = React.useState(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages, requestMetadata }) => {
          const sentConfig = (requestMetadata as { config?: ToolConfigKey } | undefined)?.config;
          return {
            body: { chatId: id, message: messages.at(-1), config: sentConfig ?? defaultConfig },
          };
        },
      }),
  );

  const { messages, status, sendMessage } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
  });

  const handleSend = React.useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || status === "submitted") return;
      void sendMessage({ text: trimmed, metadata: { config } });
    },
    [sendMessage, status, config],
  );

  const handleConfigChange = React.useCallback((next: ToolConfigKey) => {
    setConfig(next);
  }, []);

  return (
    <div className="flex h-[calc(100svh-1rem)] min-h-0 flex-col">
      <div className="shrink-0 border-b px-6 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <ConfigSelector value={config} onChange={handleConfigChange} />
        </div>
      </div>

      <ChatMessages messages={messages} status={status} ledger={ledger} />

      <Composer onSend={handleSend} disabled={status === "submitted"} />
    </div>
  );
}