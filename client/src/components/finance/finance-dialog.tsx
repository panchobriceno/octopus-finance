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
        "grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl border-white/10 bg-[#11101b] p-0 text-[#f1e9fc] shadow-[0_24px_70px_rgba(0,0,0,0.45)] sm:max-h-[calc(100dvh-4rem)]",
        "outline-none focus:outline-none focus-visible:ring-1 focus-visible:ring-[#bb9eff]/40",
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
          <DialogTitle className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[#f1e9fc]">
            {icon ? (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#bb9eff]/15 text-[#d8c7ff]">
                {icon}
              </span>
            ) : null}
            <span className="min-w-0 truncate">{title}</span>
          </DialogTitle>
          {description ? (
            <DialogDescription className="mt-2 text-sm text-[#aea8be]">
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
        "max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border-white/10 bg-[#11101b] p-0 text-[#f1e9fc] shadow-[0_24px_70px_rgba(0,0,0,0.45)] sm:max-h-[calc(100dvh-4rem)]",
        "outline-none focus:outline-none focus-visible:ring-1 focus-visible:ring-[#bb9eff]/40",
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
      <AlertDialogTitle className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[#f1e9fc]">
        {icon ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#ff6f8d]/25 bg-[#ff6f8d]/15 text-[#ff9aaf]">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 truncate">{title}</span>
      </AlertDialogTitle>
      {description ? (
        <AlertDialogDescription className="mt-2 text-sm text-[#aea8be]">
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
}: {
  value: TValue;
  options: Array<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-[#1a1528] p-1 text-xs font-bold">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            "whitespace-nowrap rounded-md px-3 py-2 text-[#aea8be] outline-none transition hover:text-[#f1e9fc] focus-visible:ring-2 focus-visible:ring-[#bb9eff]/55 sm:px-4",
            value === option.value && "bg-[#36304a] text-[#f1e9fc]",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
