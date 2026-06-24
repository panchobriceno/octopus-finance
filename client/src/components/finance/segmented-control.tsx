import { cn } from "@/lib/utils";

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  testId?: string;
};

/**
 * Control segmentado (pills) — usado en los modales de movimiento (Fase modales).
 *
 * Presentación pura: reemplaza un <Select> de pocas opciones por pills al estilo
 * del mockup (activo = lila --primary con glow). El padre conserva su handler
 * de cambio, así que la lógica no se altera.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  testId,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn("inline-flex w-full gap-1 rounded-lg bg-muted/60 p-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={option.testId}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-[#bb9eff] text-[#0f0c1c] shadow-[0_0_12px_rgba(187,158,255,0.35)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
