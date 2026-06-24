import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type OverviewScope = "all" | "family" | "business";

const SCOPE_LABELS: Record<OverviewScope, string> = {
  all: "Ambos",
  family: "Personal",
  business: "Empresa",
};

export function OverviewScopeToggle({
  value,
  onChange,
}: {
  value: OverviewScope;
  onChange: (value: OverviewScope) => void;
}) {
  return (
    <div className="inline-flex flex-none rounded-lg border border-white/10 bg-[#1a1528] p-1 text-xs font-bold">
      {(Object.keys(SCOPE_LABELS) as OverviewScope[]).map((scope) => (
        <button
          key={scope}
          type="button"
          className={cn(
            "whitespace-nowrap rounded-md px-3 py-2 text-[#aea8be] transition hover:text-[#f1e9fc] sm:px-4",
            value === scope && "bg-[#36304a] text-[#f1e9fc]",
          )}
          onClick={() => onChange(scope)}
        >
          {SCOPE_LABELS[scope]}
        </button>
      ))}
    </div>
  );
}

export function OverviewMetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-[#9ef0cf]"
      : tone === "negative"
        ? "text-[#ff6f8d]"
        : "text-[#f1e9fc]";

  return (
    <Card className="rounded-2xl border-white/10 bg-[#11101b]">
      <CardContent className="p-5">
        <p className="text-sm text-[#aea8be]">{label}</p>
        <p className={cn("mt-3 break-words font-mono text-2xl font-bold tabular-nums", toneClass)}>
          {value}
        </p>
        <p className="mt-2 text-xs text-[#aea8be]">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function OverviewPanel({
  title,
  children,
  className,
  contentClassName,
  aside,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  aside?: ReactNode;
}) {
  return (
    <Card className={cn("rounded-2xl border-white/10 bg-[#11101b]", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
        <CardTitle className="min-w-0 text-base font-bold">{title}</CardTitle>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}
