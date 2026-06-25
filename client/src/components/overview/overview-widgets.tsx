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
    <div className="inline-flex flex-none rounded-full border border-card-border bg-[#121219] p-1 text-xs font-bold">
      {(Object.keys(SCOPE_LABELS) as OverviewScope[]).map((scope) => (
        <button
          key={scope}
          type="button"
          className={cn(
            "whitespace-nowrap rounded-full px-3 py-1.5 transition sm:px-4",
            value === scope
              ? "bg-[#cdfa46] text-[#0a0a0f]"
              : "text-[#9a9aa6] hover:text-[#f4f4f7]",
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
  icon,
  onDetail,
}: {
  label: string;
  value: string;
  detail: ReactNode;
  tone?: "positive" | "negative" | "neutral";
  icon?: ReactNode;
  onDetail?: () => void;
}) {
  const toneClass =
    tone === "positive"
      ? "text-[#cdfa46]"
      : tone === "negative"
        ? "text-[#e3e3ea]"
        : "text-[#f4f4f7]";

  return (
    <Card className="flex flex-col rounded-[20px] border-card-border bg-card">
      <CardContent className="flex flex-1 flex-col p-[18px]">
        <div className="flex items-center gap-2">
          {icon ? <span className="text-[#cfcfd8]">{icon}</span> : null}
          <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{label}</p>
        </div>
        <p className={cn("mt-3 break-words font-mono text-[22px] font-bold leading-none tabular-nums", toneClass)}>
          {value}
        </p>
        <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{detail}</div>
        {onDetail ? (
          <button
            type="button"
            onClick={onDetail}
            className="mt-auto flex items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2 pt-2 text-xs font-semibold text-[#cfcfd8] transition-colors hover:bg-[#22222b]"
          >
            Ver detalle
            <ChevronRight className="size-3.5 text-[hsl(var(--muted-foreground))]" />
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
    <Card className={cn("rounded-[20px] border-card-border bg-card", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
        <CardTitle className="min-w-0 text-[15px] font-bold">{title}</CardTitle>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}
