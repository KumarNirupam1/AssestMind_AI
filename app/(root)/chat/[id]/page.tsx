import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { ChatConversation } from "@/features/chat/components/chat-conversation";
import { getChatForUser, loadEvidenceLedger } from "@/features/chat/queries";
import { loadedToUIMessages, loadChatMessages } from "@/lib/agent/chat-store";
import { prisma } from "@/lib/db";

export const metadata = { title: "Investigate" };

/**
 * A single investigation conversation. The server owns the read path: it
 * rebuilds the client's message list from ChatMessage rows and hands the
 * evidence ledger across, so the trace panel works on reload even though
 * tool parts are never persisted (only role + text + evidence are).
 */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth.protect();

  const chat = await getChatForUser(id, userId);
  if (!chat) notFound();

  const [loaded, ledger] = await Promise.all([
    loadChatMessages(prisma, id),
    loadEvidenceLedger(id),
  ]);

  return (
    <ChatConversation
      chatId={id}
      title={chat.title ?? "New chat"}
      initialMessages={loadedToUIMessages(loaded)}
      ledger={ledger}
    />
  );
}