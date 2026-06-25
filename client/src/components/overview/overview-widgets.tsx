import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
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
    <div className="inline-flex flex-none rounded-lg border border-white/10 bg-[#15151c] p-1 text-xs font-bold">
      {(Object.keys(SCOPE_LABELS) as OverviewScope[]).map((scope) => (
        <button
          key={scope}
          type="button"
          className={cn(
            "whitespace-nowrap rounded-md px-3 py-2 text-[#9a9aa6] transition hover:text-[#f4f4f7] sm:px-4",
            value === scope && "bg-[#2a2a34] text-[#f4f4f7]",
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
  onDetail,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
  onDetail?: () => void;
}) {
  const toneClass =
    tone === "positive"
      ? "text-[#cdfa46]"
      : tone === "negative"
        ? "text-[#e3e3ea]"
        : "text-[#f4f4f7]";

  return (
    <Card className="flex flex-col rounded-2xl border-white/10 bg-[#0d0d12]">
      <CardContent className="flex flex-1 flex-col p-5">
        <p className="text-sm text-[#9a9aa6]">{label}</p>
        <p className={cn("mt-3 break-words font-mono text-2xl font-bold tabular-nums", toneClass)}>
          {value}
        </p>
        <p className="mt-2 text-xs text-[#9a9aa6]">{detail}</p>
        {onDetail ? (
          <button
            type="button"
            onClick={onDetail}
            className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#15151c] px-3 py-2 text-xs font-semibold text-[#cfcfd8] transition-colors hover:bg-[#22222b]"
          >
            Ver detalle
            <ChevronRight className="size-3.5 text-[#9a9aa6]" />
          </button>
        ) : null}
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
    <Card className={cn("rounded-2xl border-white/10 bg-[#0d0d12]", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
        <CardTitle className="min-w-0 text-base font-bold">{title}</CardTitle>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}
