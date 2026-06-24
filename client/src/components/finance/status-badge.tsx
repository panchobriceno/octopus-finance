import { cn } from "@/lib/utils";

export type MovementStatus =
  | "pagado"
  | "pendiente"
  | "vencido"
  | "conciliado"
  | "duplicado";

const STYLES: Record<MovementStatus, string> = {
  pagado: "bg-lime-500/15 text-lime-300 border-lime-400/20",
  pendiente: "bg-zinc-500/15 text-zinc-300 border-zinc-400/20",
  vencido: "bg-[#e3e3ea]/15 text-[#e3e3ea] border-[#e3e3ea]/25",
  conciliado: "bg-[#cdfa46]/15 text-[#cfcfd8] border-[#cdfa46]/25",
  duplicado: "bg-zinc-500/10 text-zinc-300 border-zinc-400/25",
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
