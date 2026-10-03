import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { reserveNewChat } from "@/features/chat/queries";

/**
 * "New chat": reserve an untitled, empty conversation and land on it.
 * Mirror of the reference chat app — no POST-to-create; the empty chat IS the
 * new-chat state handled by `reserveNewChat`.
 */
export default async function NewChatPage() {
  const { userId } = await auth.protect();
  const id = await reserveNewChat(userId);
  redirect(`/chat/${id}`);
}