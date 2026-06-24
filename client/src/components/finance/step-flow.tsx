import { Link } from "wouter";
import { cn } from "@/lib/utils";

export type StepFlowStep = {
  label: string;
  hint?: string;
  /** Si se pasa, el paso enlaza a esa ruta (debe existir en App.tsx). */
  href?: string;
  onClick?: () => void;
};

/**
 * Guía estática de orientación — Fase 1.1.
 *
 * NO es un stepper con estado: solo orienta el flujo de 3 pasos. El paso 1 puede
 * abrir el wizard global de importación sin sacar al usuario de la bandeja.
 */
export function StepFlow({
  steps,
  className,
}: {
  steps: StepFlowStep[];
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border/60 bg-card/60 p-3 sm:flex-row sm:items-center sm:gap-1",
        className,
      )}
    >
      {steps.map((step, index) => {
        const inner = (
          <span className="flex items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#cdfa46]/15 text-xs font-bold text-[#cdfa46]">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">{step.label}</span>
              {step.hint ? (
                <span className="block text-xs text-muted-foreground leading-tight">{step.hint}</span>
              ) : null}
            </span>
          </span>
        );
        return (
          <li key={step.label} className="flex flex-1 items-center gap-1">
            {step.onClick ? (
              <button
                type="button"
                onClick={step.onClick}
                className="rounded-lg px-1 text-left transition hover:opacity-80"
              >
                {inner}
              </button>
            ) : step.href ? (
              <Link
                href={step.href}
                className="rounded-lg px-1 transition hover:opacity-80"
              >
                {inner}
              </Link>
            ) : (
              <span className="px-1">{inner}</span>
            )}
            {index < steps.length - 1 ? (
              <span className="hidden flex-1 border-t border-dashed border-border/60 sm:block" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
