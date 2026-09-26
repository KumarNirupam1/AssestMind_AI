import { auth } from "@clerk/nextjs/server";
import { AppShell } from "@/features/assets/components/app-shell";
import { getNavAssets } from "@/features/assets/queries";

/**
 * Authenticated app layout. Guards the route and wraps content in the shell.
 * Clerk owns user identity, so there is no local user sync step here.
 */
const RootGroupLayout = async ({ children }: { children: React.ReactNode }) => {
  await auth.protect();
  const assets = await getNavAssets();

  return <AppShell assets={assets}>{children}</AppShell>;
};

export default RootGroupLayout;
