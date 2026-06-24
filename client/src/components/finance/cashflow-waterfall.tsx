import { AmountText } from "@/components/finance/amount-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCLP } from "@/lib/utils";

type CashflowWaterfallProps = {
  openingBalance: number;
  realIncome: number;
  realExpenses: number;
  realEndingBalance: number;
  plannedIncome: number;
  plannedExpenses: number;
  projectedEndingBalance: number;
  className?: string;
};

type Step =
  | { kind: "base" | "subtotal" | "final"; label: string; value: number }
  | { kind: "delta"; label: string; value: number; planned?: boolean };

/**
 * Cascada del mes — Fase 2.2.
 *
 * Re-visualiza EXACTAMENTE los componentes que las cards Ejecutado/Proyectado
 * ya muestran, encadenados como saldo corriente. Cierra en el
 * projectedEndingBalance que la página ya calcula (no hay número nuevo).
 * Distingue lo real (sólido) de lo esperado (atenuado) para no presentar la
 * proyección como verdad contable.
 */
export function CashflowWaterfall({
  openingBalance,
  realIncome,
  realExpenses,
  realEndingBalance,
  plannedIncome,
  plannedExpenses,
  projectedEndingBalance,
  className,
}: CashflowWaterfallProps) {
  const steps: Step[] = [
    { kind: "base", label: "Saldo inicial", value: openingBalance },
    { kind: "delta", label: "Ingresos reales", value: realIncome },
    { kind: "delta", label: "Gastos reales", value: -realExpenses },
    { kind: "subtotal", label: "Saldo ejecutado", value: realEndingBalance },
    { kind: "delta", label: "Ingresos esperados", value: plannedIncome, planned: true },
    { kind: "delta", label: "Gastos esperados", value: -plannedExpenses, planned: true },
    { kind: "final", label: "Saldo proyectado", value: projectedEndingBalance },
  ];

  return (
    <Card className={className} data-testid="cashflow-waterfall">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Cascada del mes</CardTitle>
        <p className="text-xs text-muted-foreground">
          Del saldo inicial al proyectado. Lo esperado va atenuado.
        </p>
      </CardHeader>
      <CardContent className="space-y-1">
        {steps.map((step) => {
          const isAnchor = step.kind === "subtotal" || step.kind === "final";
          return (
            <div
              key={step.label}
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
                step.kind === "final" && "bg-[#bb9eff]/10 font-semibold",
                step.kind === "subtotal" && "border-t border-border/60 font-medium",
                step.kind === "delta" && (step.planned ? "opacity-70" : ""),
              )}
            >
              <span className={cn(isAnchor ? "text-foreground" : "text-muted-foreground")}>
                {step.label}
              </span>
              {step.kind === "delta" ? (
                <AmountText value={step.value} showSign className="tabular-nums" />
              ) : (
                <span className="font-mono tabular-nums text-foreground">
                  {formatCLP(step.value)}
                </span>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
