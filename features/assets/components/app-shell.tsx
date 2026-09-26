"use client";

import { AppSidebar, type NavAsset } from "@/features/assets/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * App shell with a collapsible sidebar. `assets` is fetched on the server by
 * the route layout and passed straight through — the client component performs
 * no data fetching of its own.
 */
export function AppShell({
  children,
  assets,
}: {
  children: React.ReactNode;
  assets: NavAsset[];
}) {
  return (
    <SidebarProvider>
      <AppSidebar assets={assets} />
      <SidebarInset className="min-h-svh">{children}</SidebarInset>
    </SidebarProvider>
  );
}
