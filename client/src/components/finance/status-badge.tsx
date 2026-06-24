import { cn } from "@/lib/utils";

export type MovementStatus =
  | "pagado"
  | "pendiente"
  | "vencido"
  | "conciliado"
  | "duplicado";

const STYLES: Record<MovementStatus, string> = {
  pagado: "bg-emerald-500/15 text-emerald-300 border-emerald-400/20",
  pendiente: "bg-amber-500/15 text-amber-300 border-amber-400/20",
  vencido: "bg-[#ff6f8d]/15 text-[#ff8da3] border-[#ff6f8d]/25",
  conciliado: "bg-[#bb9eff]/15 text-[#cdbcff] border-[#bb9eff]/25",
  duplicado: "bg-amber-500/10 text-amber-300 border-amber-400/25",
};

const LABELS: Record<MovementStatus, string> = {
  pagado: "Pagado",
  pendiente: "Pendiente",
  vencido: "Vencido",
  conciliado: "Conciliado",
  duplicado: "Duplicado",
};

export function StatusBadge({
  status,
  className,
}: {
  status: MovementStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold",
        STYLES[status],
        className,
      )}
    >
      {LABELS[status]}
    </span>
  );
}
