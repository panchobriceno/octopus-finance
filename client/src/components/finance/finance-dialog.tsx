import type { ReactNode } from "react";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type FinanceDialogSize = "sm" | "md" | "lg";

const sizeClass: Record<FinanceDialogSize, string> = {
  sm: "sm:max-w-xl",
  md: "sm:max-w-3xl",
  lg: "sm:max-w-5xl",
};

export function FinanceDialogContent({
  children,
  className,
  size = "md",
}: {
  children: ReactNode;
  className?: string;
  size?: FinanceDialogSize;
}) {
  return (
    <DialogContent
      className={cn(
        "grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl border-white/10 bg-[#0d0d12] p-0 text-[#f4f4f7] shadow-[0_24px_70px_rgba(0,0,0,0.45)] sm:max-h-[calc(100dvh-4rem)]",
        "outline-none focus:outline-none focus-visible:ring-1 focus-visible:ring-[#cdfa46]/40",
        sizeClass[size],
        className,
      )}
    >
      {children}
    </DialogContent>
  );
}

export function FinanceDialogHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <DialogHeader className="border-b border-white/7 px-5 py-4 pr-12 text-left sm:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[#f4f4f7]">
            {icon ? (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#cdfa46]/15 text-[#d8c7ff]">
                {icon}
              </span>
            ) : null}
            <span className="min-w-0 truncate">{title}</span>
          </DialogTitle>
          {description ? (
            <DialogDescription className="mt-2 text-sm text-[#9a9aa6]">
              {description}
            </DialogDescription>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </DialogHeader>
  );
}

export function FinanceAlertDialogContent({
  children,
  className,
  size = "sm",
}: {
  children: ReactNode;
  className?: string;
  size?: FinanceDialogSize;
}) {
  return (
    <AlertDialogContent
      className={cn(
        "max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border-white/10 bg-[#0d0d12] p-0 text-[#f4f4f7] shadow-[0_24px_70px_rgba(0,0,0,0.45)] sm:max-h-[calc(100dvh-4rem)]",
        "outline-none focus:outline-none focus-visible:ring-1 focus-visible:ring-[#cdfa46]/40",
        sizeClass[size],
        className,
      )}
    >
      {children}
    </AlertDialogContent>
  );
}

export function FinanceAlertDialogHeader({
  title,
  description,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <AlertDialogHeader className="border-b border-white/7 px-5 py-4 text-left sm:px-6">
      <AlertDialogTitle className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[#f4f4f7]">
        {icon ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#e3e3ea]/25 bg-[#e3e3ea]/15 text-[#ff9aaf]">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{title}</span>
      </AlertDialogTitle>
      {description ? (
        <AlertDialogDescription className="mt-2 text-sm text-[#9a9aa6]">
          {description}
        </AlertDialogDescription>
      ) : null}
    </AlertDialogHeader>
  );
}

export function FinanceDialogBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-h-0 overflow-y-auto px-5 py-5 sm:px-6", className)}>
      {children}
    </div>
  );
}

export function FinanceDialogFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col-reverse gap-2 border-t border-white/7 px-5 py-4 sm:flex-row sm:justify-end sm:px-6", className)}>
      {children}
    </div>
  );
}

export function FinanceSegmentedControl<TValue extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  testId,
}: {
  value: TValue;
  options: Array<{ value: TValue; label: string; testId?: string }>;
  onChange: (value: TValue) => void;
  ariaLabel?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn("inline-flex rounded-lg border border-white/10 bg-[#15151c] p-1 text-xs font-bold", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          data-testid={option.testId}
          className={cn(
            "whitespace-nowrap rounded-md px-3 py-2 text-[#9a9aa6] outline-none transition hover:text-[#f4f4f7] focus-visible:ring-2 focus-visible:ring-[#cdfa46]/55 sm:px-4",
            value === option.value && "bg-[#2a2a34] text-[#f4f4f7]",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
