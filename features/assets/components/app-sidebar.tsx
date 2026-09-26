"use client";

import { UserButton } from "@clerk/nextjs";
import {
  ActivityIcon,
  FactoryIcon,
  GaugeIcon,
  MoonIcon,
  SunIcon,
  WrenchIcon,
} from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import * as React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export type NavAsset = {
  id: string;
  name: string;
  faultCount: number;
  unresolvedCount: number;
};

function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-xl border border-sidebar-border bg-sidebar text-[15px] font-semibold tracking-tight text-sidebar-foreground",
        className,
      )}
      aria-hidden
    >
      A
    </span>
  );
}

/**
 * Theme toggle driven purely by CSS.
 *
 * Reading `resolvedTheme` during render is what forces the usual
 * `useEffect` + `setMounted` dance, and that in turn causes a hydration
 * mismatch and a cascading render. Both icons and both labels are rendered
 * and the `.dark` class decides which is visible, so there is no state to
 * synchronise. `resolvedTheme` is only read inside the click handler, which
 * never runs on the server.
 */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Toggle theme"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      >
        <MoonIcon className="dark:hidden" />
        <SunIcon className="hidden dark:block" />
        <span className="group-data-[collapsible=icon]:hidden dark:hidden">
          Dark mode
        </span>
        <span className="hidden group-data-[collapsible=icon]:hidden dark:inline">
          Light mode
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Application sidebar. Receives its asset list from the server so that no
 * client-side data fetching is involved in the read path.
 */
export function AppSidebar({ assets = [] }: { assets?: NavAsset[] }) {
  const totalUnresolved = assets.reduce((n, a) => n + a.unresolvedCount, 0);

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-1">
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                className="font-semibold tracking-tight"
                render={<Link href="/" />}
                tooltip="AssetMind AI"
              >
                <BrandMark />
                <span className="truncate">AssetMind</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarTrigger className="shrink-0" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Overview</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Fleet dashboard" render={<Link href="/" />}>
                  <GaugeIcon />
                  <span className="group-data-[collapsible=icon]:hidden">
                    Fleet dashboard
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>
            Assets
            {totalUnresolved > 0 ? (
              <span className="ml-auto text-[10px] tabular-nums text-destructive">
                {totalUnresolved} open
              </span>
            ) : null}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {assets.map((asset) => (
                <SidebarMenuItem key={asset.id}>
                  <SidebarMenuButton
                    tooltip={`${asset.name} — ${asset.faultCount} faults`}
                    render={<Link href={`/assets/${asset.id}`} />}
                  >
                    <FactoryIcon />
                    <span className="truncate group-data-[collapsible=icon]:hidden">
                      {asset.name}
                    </span>
                    {asset.unresolvedCount > 0 ? (
                      <span className="ml-auto text-[10px] tabular-nums text-destructive group-data-[collapsible=icon]:hidden">
                        {asset.unresolvedCount}
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {assets.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  No assets found. Run the seed script.
                </p>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="mt-auto shrink-0 border-t border-sidebar-border/60">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Investigation chat (Phase 5)" disabled>
              <ActivityIcon />
              <span className="group-data-[collapsible=icon]:hidden">
                Investigate
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Guardrails (Phase 2)" disabled>
              <WrenchIcon />
              <span className="group-data-[collapsible=icon]:hidden">
                Guardrails
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <ThemeToggle />
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-1 py-1.5 group-data-[collapsible=icon]:justify-center">
              <UserButton appearance={{ elements: { avatarBox: "size-8" } }} />
              <span className="truncate text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
                Account
              </span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarRail />
      </SidebarFooter>
    </Sidebar>
  );
}
