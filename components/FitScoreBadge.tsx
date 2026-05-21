import { cn } from "@/lib/utils";

export function FitScoreBadge({ score }: { score: number }) {
  const color =
    score >= 85
      ? "bg-sentry-100 text-sentry-900 ring-sentry-500/20"
      : score >= 65
        ? "bg-blue-50 text-blue-800 ring-blue-500/20"
        : score > 0
          ? "bg-amber-50 text-amber-800 ring-amber-500/20"
          : "bg-slate-100 text-slate-600 ring-slate-500/20";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1", color)}>
      {score || "New"}{score ? "/100" : ""}
    </span>
  );
}
