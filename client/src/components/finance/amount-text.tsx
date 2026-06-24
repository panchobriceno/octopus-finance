import { cn, formatCLP } from "@/lib/utils";

type AmountTextProps = {
  value: number;
  className?: string;
  /** Antepone "+" en positivos. */
  showSign?: boolean;
  /** "auto" = color por signo. "positive"/"negative" fuerzan semántica. */
  tone?: "auto" | "neutral" | "positive" | "negative";
};

const POSITIVE = "text-emerald-700 dark:text-emerald-300";
const NEGATIVE = "text-red-700 dark:text-[#ff8da3]";
const ZERO = "text-muted-foreground";

/**
 * Fuente única de verdad para mostrar montos.
 * Color semántico fijo + tabular-nums, reutilizando formatCLP del repo.
 */
export function AmountText({
  value,
  className,
  showSign = false,
  tone = "auto",
}: AmountTextProps) {
  const color =
    tone === "neutral"
      ? ""
      : tone === "positive"
        ? POSITIVE
        : tone === "negative"
          ? NEGATIVE
          : value > 0
            ? POSITIVE
            : value < 0
              ? NEGATIVE
              : ZERO;
  const sign = showSign && value > 0 ? "+" : "";

  return (
    <span className={cn("font-mono tabular-nums", color, className)}>
      {sign}
      {formatCLP(value)}
    </span>
  );
}
