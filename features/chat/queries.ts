import { EVIDENCE_ENTRY_SCHEMA, type EvidenceEntry } from "@/features/evaluation/run-manifest.ts";
import { prisma } from "@/lib/db";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Server read path for the investigation chat (Phase 5).
 *
 * The sidebar list and the conversation page are Server Components over
 * Prisma — same "no API hop / no React Query" rule as Phase 1's asset views.
 * Writes stay in `lib/agent/chat-store.ts`, which is the only module that
 * touches ChatMessage.
 */

export type ChatSummary = {
  id: string;
  title: string;
  /** When the latest message was written (null for an untouched chat). */
  lastActivityAt: Date;
};

/**
 * Conversation history ordered by recency. `Chat.updatedAt` only moves on a
 * few writes, so recency is derived from the latest message's createdAt —
 * read as an embedded relation, one query, no post-join.
 */
export async function listChats(clerkUserId: string): Promise<ChatSummary[]> {
  const chats = await prisma.chat.findMany({
    where: { clerkUserId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  return chats
    .map((chat) => ({
      id: chat.id,
      title: chat.title ?? "New chat",
      lastActivityAt: chat.messages[0]?.createdAt ?? chat.createdAt,
    }))
    .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}

export type OwnedChat = {
  id: string;
  title: string | null;
};

/** Ownership check: the chat must belong to the requesting user. */
export async function getChatForUser(
  chatId: string,
  clerkUserId: string,
  db: PrismaClient = prisma,
): Promise<OwnedChat | null> {
  const chat = await db.chat.findFirst({
    where: { id: chatId, clerkUserId },
    select: { id: true, title: true },
  });
  return chat;
}

/**
 * Get an untitled, empty conversation to serve as the "new chat" — reuse one
 * if it exists (avoids junk rows on every visit) else create it.
 */
export async function reserveNewChat(clerkUserId: string, db: PrismaClient = prisma): Promise<string> {
  const reusable = await db.chat.findFirst({
    where: { clerkUserId, title: null, messages: { none: {} } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (reusable) return reusable.id;

  const created = await db.chat.create({
    data: { clerkUserId },
    select: { id: true },
  });
  return created.id;
}

/** The persisted evidence ledger per assistant message, for the trace panel. */
export type EvidenceLedger = {
  byMessageId: Record<string, EvidenceEntry[]>;
};

export async function loadEvidenceLedger(
  chatId: string,
  db: PrismaClient = prisma,
): Promise<EvidenceLedger> {
  const rows = await db.chatMessage.findMany({
    where: { chatId, role: "ASSISTANT", evidence: { not: Prisma.DbNull } },
    select: { id: true, evidence: true, evidenceVersion: true },
  });

  const byMessageId: Record<string, EvidenceEntry[]> = {};
  for (const row of rows) {
    const parsed = EVIDENCE_ENTRY_SCHEMA.array().safeParse(row.evidence);
    if (parsed.success) byMessageId[row.id] = parsed.data;
  }
  return { byMessageId };
}