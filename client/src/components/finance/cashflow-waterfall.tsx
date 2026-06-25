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
 * Cascada del mes — sistema lima-mono.
 *
 * Re-visualiza EXACTAMENTE los componentes que las cards Ejecutado/Proyectado
 * ya muestran, encadenados como saldo corriente. Cierra en el
 * projectedEndingBalance que la página ya calcula (no hay número nuevo).
 * Real = color pleno (lima entra / blanco sale); esperado = atenuado + punteado.
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
    <Card className={cn("rounded-[20px] border-card-border", className)} data-testid="cashflow-waterfall">
      <CardHeader className="pb-2">
        <CardTitle className="text-[15px] font-bold">Cascada del mes</CardTitle>
        <p className="text-xs text-[#9a9aa6]">Del saldo inicial al proyectado · lo esperado va atenuado.</p>
      </CardHeader>
      <CardContent className="space-y-1">
        {steps.map((step) => {
          const isSubtotal = step.kind === "subtotal";
          const isFinal = step.kind === "final";
          const isDelta = step.kind === "delta";
          const isPlanned = isDelta && step.planned;
          const isIncome = isDelta && step.value >= 0;
          const barColor = isIncome ? "#cdfa46" : "#e3e3ea";

          const valueClass = isFinal
            ? "font-extrabold text-[#cdfa46]"
            : isSubtotal
              ? "font-bold text-[#f4f4f7]"
              : isDelta
                ? isIncome
                  ? "text-[#cdfa46]"
                  : "text-[#e3e3ea]"
                : "text-[#f4f4f7]";

          return (
            <div
              key={step.label}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm",
                isSubtotal && "border border-card-border bg-secondary font-bold",
                isFinal && "bg-[rgba(205,250,70,0.08)]",
                isPlanned && "opacity-60",
              )}
            >
              <span className="flex items-center gap-2.5">
                {isDelta ? (
                  isPlanned ? (
                    <span className="h-4 w-0 border-l-2 border-dashed" style={{ borderColor: barColor }} />
                  ) : (
                    <span className="h-4 w-[3px] rounded-full" style={{ backgroundColor: barColor }} />
                  )
                ) : (
                  <span className="h-4 w-[3px]" />
                )}
                <span
                  className={cn(
                    isFinal
                      ? "font-extrabold text-[#cdfa46]"
                      : isSubtotal
                        ? "font-bold text-[#f4f4f7]"
                        : "text-[#cfcfd8]",
                  )}
                >
                  {step.label}
                </span>
              </span>
              <span className={cn("font-mono tabular-nums", valueClass)}>
                {isDelta && step.value > 0 ? "+" : ""}
                {formatCLP(step.value + 0)}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
