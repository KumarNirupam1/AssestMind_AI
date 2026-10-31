import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the conversation shell so navigation into a chat does not flash. */
export default function ChatLoading() {
  return (
    <div className="flex h-[calc(100svh-1rem)] min-h-0 flex-col" aria-busy="true" aria-live="polite">
      <div className="shrink-0 border-b px-6 py-4">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-8 w-40" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>

      <div className="shrink-0 border-t px-6 py-3">
        <Skeleton className="mx-auto h-10 w-full max-w-3xl rounded-lg" />
      </div>
      <span className="sr-only">Loading conversation</span>
    </div>
  );
}
