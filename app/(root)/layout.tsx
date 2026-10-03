import { auth } from "@clerk/nextjs/server";
import { AppShell } from "@/features/assets/components/app-shell";
import { getNavAssets } from "@/features/assets/queries";
import { listChats } from "@/features/chat/queries";

/**
 * Authenticated app layout. Guards the route and wraps content in the shell.
 * Clerk owns user identity, so there is no local user sync step here.
 */
const RootGroupLayout = async ({ children }: { children: React.ReactNode }) => {
  const { userId } = await auth.protect();
  const [assets, chats] = await Promise.all([getNavAssets(), listChats(userId)]);

  return (
    <AppShell assets={assets} chats={chats}>
      {children}
    </AppShell>
  );
};

export default RootGroupLayout;
