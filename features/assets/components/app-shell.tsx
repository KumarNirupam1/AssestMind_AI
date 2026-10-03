"use client";

import { AppSidebar, type NavAsset } from "@/features/assets/components/app-sidebar";
import type { ChatSummary } from "@/features/chat/queries";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * App shell with a collapsible sidebar. `assets` and `chats` are fetched on
 * the server by the route layout and passed straight through — the client
 * component performs no data fetching of its own.
 */
export function AppShell({
  children,
  assets,
  chats,
}: {
  children: React.ReactNode;
  assets: NavAsset[];
  chats: ChatSummary[];
}) {
  return (
    <SidebarProvider>
      <AppSidebar assets={assets} chats={chats} />
      <SidebarInset className="min-h-svh">{children}</SidebarInset>
    </SidebarProvider>
  );
}
