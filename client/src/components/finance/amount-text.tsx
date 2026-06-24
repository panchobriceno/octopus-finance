import { cn, formatCLP } from "@/lib/utils";

type AmountTextProps = {
  value: number;
  className?: string;
  /** Antepone "+" en positivos. */
  showSign?: boolean;
  /** "auto" = verde/rosa por signo · "neutral" = sin color semántico. */
  tone?: "auto" | "neutral";
};

const POSITIVE = "text-emerald-300";
const NEGATIVE = "text-[#ff6f8d]"; // --destructive
const ZERO = "text-muted-foreground";

/**
 * Fuente única de verdad para mostrar montos.
 * Color semántico fijo + tabular-nums, reutilizando formatCLP del repo.
 *
 * NOTE: confirma que `formatCLP` se exporta desde "@/lib/utils" (lo usa
 * data-health.tsx). Si vive en otro módulo, ajusta el import.
 */
export function AmountText({
  value,
  className,
  showSign = false,
  tone = "auto",
}: AmountTextProps) {
  const color =
    tone === "neutral" ? "" : value > 0 ? POSITIVE : value < 0 ? NEGATIVE : ZERO;
  const sign = showSign && value > 0 ? "+" : "";

  return (
    <span className={cn("font-mono tabular-nums", color, className)}>
      {sign}
      {formatCLP(value)}
    </span>
  );
}
