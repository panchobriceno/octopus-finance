import { useMemo } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useFinanceAudit } from "@/hooks/use-finance-audit";
import type { AuditSeverity } from "@/domain/finance-audit";
import { Card, CardContent } from "@/components/ui/card";

const ORDER: Record<AuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const ACCENT: Record<AuditSeverity, string> = {
  critical: "text-[#ff6f8d] bg-[#ff6f8d]/12",
  high: "text-[#ff6f8d] bg-[#ff6f8d]/10",
  medium: "text-amber-300 bg-amber-500/12",
  low: "text-[#cdbcff] bg-[#bb9eff]/12",
};

// area -> pantalla destino (rutas actuales de App.tsx, sin cambios)
const TARGET: Record<string, string> = {
  reconciliation: "/movements",
  "data-integrity": "/data-health",
};

/**
 * Feed "Requiere tu atención" del Resumen.
 *
 * Se agrega de forma ADITIVA, sin reemplazar el bloque decisionAlerts existente
 * (que cubre decisiones de caja: deuda TC, cobros, movimientos sin cuenta). Esto
 * surface issues del motor de auditoría (integridad de datos + conciliación), una
 * fuente complementaria. Consolidar ambos queda como decisión de producto.
 * Retorna null si no hay issues, así que no agrega ruido cuando está todo OK.
 */
export function AttentionFeed({ limit = 4 }: { limit?: number }) {
  const [, navigate] = useLocation();
  const { issues } = useFinanceAudit();

  const top = useMemo(
    () =>
      [...issues]
        .sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
        .slice(0, limit),
    [issues, limit],
  );

  if (top.length === 0) return null;

  return (
    <Card className="border-[#bb9eff]/12 bg-card/90">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <AlertTriangle className="size-4 text-amber-400" />
            Requiere tu atención
          </h3>
          <span className="text-xs text-muted-foreground">
            {issues.length} en total
          </span>
        </div>
        <div className="space-y-2">
          {top.map((issue) => (
            <button
              key={issue.id}
              type="button"
              onClick={() => navigate(TARGET[issue.area] ?? "/data-health")}
              className="flex w-full items-center gap-3 rounded-xl border border-[#bb9eff]/10 bg-background/30 px-3 py-2.5 text-left transition hover:bg-background/50"
              data-testid={`attention-issue-${issue.id}`}
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${ACCENT[issue.severity]}`}
              >
                !
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {issue.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {issue.detail}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
