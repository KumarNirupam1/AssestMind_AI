import { isTextUIPart, type UIMessage } from "ai";

import type { EvidenceEntry } from "@/features/evaluation/run-manifest.ts";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Persistence for the investigation chat.
 *
 * The AI SDK's UIMessage model is the wire format to the model and the client;
 * the DB stores only role + final text (plus the evidence ledger). Tool-result
 * parts are deliberately not persisted: on the next turn the model only needs
 * the finished answers, and re-sending rich tool payloads would inflate every
 * subsequent context window.
 */

export function messageText(message: UIMessage): string {
  return message.parts.filter(isTextUIPart).map((part) => part.text).join("");
}

export type LoadedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export async function loadChatMessages(
  prisma: PrismaClient,
  chatId: string,
): Promise<LoadedMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
  });
  return rows.map((row) => ({
    id: row.id,
    role: row.role === "ASSISTANT" ? "assistant" : "user",
    content: row.content,
  }));
}

/** Reconstruct stored history as UIMessages (text-only parts). */
export function loadedToUIMessages(loaded: LoadedMessage[]): UIMessage[] {
  return loaded.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text", text: m.content }],
  }));
}

/** Reconstruct the model-view of history as UIMessages (text-only). */
export function toUIMessages(loaded: LoadedMessage[], incoming: UIMessage): UIMessage[] {
  return [...loadedToUIMessages(loaded), incoming];
}

/** Store the user message once; retries of the same message id are no-ops. */
export async function saveUserMessage(
  prisma: PrismaClient,
  chatId: string,
  message: UIMessage,
): Promise<{ alreadyStored: boolean }> {
  // Message ids are client-supplied, so the id alone is not proof of a retry.
  // A row in a different chat is treated as foreign and never re-written.
  const existing = await prisma.chatMessage.findUnique({
    where: { id: message.id },
    select: { chatId: true },
  });
  if (existing) return { alreadyStored: existing.chatId === chatId };

  const content = messageText(message);

  await prisma.chatMessage.create({
    data: {
      id: message.id,
      chatId,
      role: "USER",
      content,
      evidence: Prisma.DbNull,
      evidenceVersion: 1,
    },
  });

  // Auto-title the conversation from its first user message. Only writes when
  // the chat is still untitled, so later turns never overwrite a rename.
  const firstLine = content.split("\n", 1)[0]?.trim();
  if (firstLine) {
    await prisma.chat.updateMany({
      where: { id: chatId, title: null },
      data: { title: firstLine.slice(0, 48) },
    });
  }

  return { alreadyStored: false };
}

/**
 * Persist the assistant's final parts and the turn's evidence ledger.
 *
 * `finalMessages` is the whole streamed conversation, not just this turn, so
 * only rows that are new or whose content changed are written. A message id
 * owned by another chat is skipped rather than overwritten.
 */
export async function saveAssistantTurn(
  prisma: PrismaClient,
  chatId: string,
  finalMessages: UIMessage[],
  evidence: EvidenceEntry[],
): Promise<void> {
  const assistantMessages = finalMessages.filter((message) => message.role === "assistant");
  if (assistantMessages.length === 0) return;

  const existingRows = await prisma.chatMessage.findMany({
    where: { id: { in: assistantMessages.map((message) => message.id) } },
    select: { id: true, chatId: true, content: true },
  });
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const evidenceValue =
    evidence.length > 0 ? (evidence as unknown as Prisma.InputJsonValue) : Prisma.DbNull;

  for (const message of assistantMessages) {
    const content = messageText(message);
    const existing = existingById.get(message.id);

    if (existing && existing.chatId !== chatId) continue;
    if (existing && existing.content === content) continue;

    await prisma.chatMessage.upsert({
      where: { id: message.id },
      create: {
        id: message.id,
        chatId,
        role: "ASSISTANT",
        content,
        evidence: evidenceValue,
        evidenceVersion: 1,
      },
      update: { content, evidence: evidenceValue },
    });
  }
}