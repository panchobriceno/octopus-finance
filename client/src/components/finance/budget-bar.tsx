import { cn, formatCLP } from "@/lib/utils";

type BudgetBarProps = {
  /** Monto presupuestado para la categoría. */
  budget: number;
  /** Referencia de ejecución ya calculada por la página = max(real, comprometido). */
  reference: number;
  /** Real ejecutado (solo para el tooltip, no se apila para no doble-contar). */
  actual?: number;
  /** Comprometido (solo para el tooltip). */
  committed?: number;
  className?: string;
};

/**
 * Barra de consumo de presupuesto — Fase 1.2.
 *
 * Visualiza EXACTAMENTE los números que la fila ya muestra: la referencia de
 * ejecución contra el presupuesto. No apila real + comprometido (la página usa
 * max() justo para no doble-contar). Sobregiro en rosa (--destructive).
 * Los desgloses real/comprometido viven en el title (hover), sin inventar
 * una narrativa visual que el cálculo no respalda.
 */
export function BudgetBar({
  budget,
  reference,
  actual,
  committed,
  className,
}: BudgetBarProps) {
  const hasBudget = budget > 0;
  if (!hasBudget && reference <= 0) return null;

  const ratio = hasBudget ? reference / budget : 0;
  const fillPct = Math.min(Math.max(ratio, 0), 1) * 100;
  const over = hasBudget && reference > budget;

  const title = [
    `Presupuesto: ${formatCLP(budget)}`,
    actual !== undefined ? `Real ejecutado: ${formatCLP(actual)}` : null,
    committed !== undefined ? `Comprometido: ${formatCLP(committed)}` : null,
    `Referencia: ${formatCLP(reference)}`,
    hasBudget ? `Uso: ${Math.round(ratio * 100)}%` : "Sin presupuesto fijado",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn("h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-muted", className)}
      title={title}
      role="img"
      aria-label={title}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300",
          over ? "bg-[#e3e3ea]" : "bg-[#cdfa46]",
        )}
        style={{ width: hasBudget ? `${over ? 100 : fillPct}%` : "100%" }}
      />
    </div>
  );
}
