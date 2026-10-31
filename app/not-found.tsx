import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

/** Matches `notFound()` calls for unknown assets and conversations. */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-mono text-xs text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        That asset, conversation, or page does not exist — or it belongs to another account.
      </p>
      <Link href="/" className={buttonVariants()}>
        Back to dashboard
      </Link>
    </main>
  );
}
