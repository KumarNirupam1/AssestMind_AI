import { Skeleton } from "@/components/ui/skeleton";

/** Asset detail fallback: header, stat row, then the tabbed record panels. */
export default function AssetLoading() {
  return (
    <div className="flex flex-col gap-6 p-6" aria-busy="true" aria-live="polite">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-xl" />
        ))}
      </div>

      <Skeleton className="h-96 w-full rounded-xl" />
      <span className="sr-only">Loading asset</span>
    </div>
  );
}
