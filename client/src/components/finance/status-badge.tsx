import { cn } from "@/lib/utils";

export type MovementStatus =
  | "pagado"
  | "pendiente"
  | "vencido"
  | "conciliado"
  | "duplicado";

// Mono: los estados van en grises etiquetados. El lima queda reservado para
// ingreso/marca/acciones, no para estados.
const STYLES: Record<MovementStatus, string> = {
  pagado: "bg-[#9aa0aa]/12 text-[#9aa0aa] border-[#9aa0aa]/20",
  pendiente: "bg-[#8a8a94]/12 text-[#8a8a94] border-[#8a8a94]/20",
  vencido: "bg-[#e3e3ea]/12 text-[#e3e3ea] border-[#e3e3ea]/25",
  conciliado: "bg-[#c8c8d2]/12 text-[#c8c8d2] border-[#c8c8d2]/20",
  duplicado: "bg-[#8a8a94]/10 text-[#8a8a94] border-[#8a8a94]/20",
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
