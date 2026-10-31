"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. Next renders this instead of the segment when a
 * Server Component or data fetch throws, so a database outage never escapes as
 * an unstyled white page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app] unhandled error", error);
  }, [error]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        This view failed to load. The failure has been logged, and retrying is safe.
      </p>
      {error.digest ? (
        <code className="text-xs text-muted-foreground">reference: {error.digest}</code>
      ) : null}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
