import { cn } from "@/lib/utils";

/**
 * Dependency-free sparkline. Colour comes from the parent via `text-*` because
 * sparklines only ever use `currentColor`.
 */
export function Sparkline({
  values,
  height = 40,
  ariaLabel,
  className,
}: {
  values: number[];
  height?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const width = 160;

  if (values.length < 2) {
    return (
      <div
        className={cn(
          "flex h-10 items-center justify-center text-[10px] text-muted-foreground",
          className,
        )}
      >
        collecting…
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const y = (value: number) => height - 2 - ((value - min) / span) * (height - 4);

  const points = values
    .map((value, index) => `${(index * stepX).toFixed(2)},${y(value).toFixed(2)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      role="img"
      aria-label={ariaLabel}
    >
      <polygon points={`0,${height} ${points} ${width},${height}`} fill="currentColor" className="opacity-10" />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
