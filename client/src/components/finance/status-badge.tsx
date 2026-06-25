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
  pagado: "bg-[rgba(154,160,170,0.14)] text-[#9aa0aa] border-[rgba(154,160,170,0.24)]",
  pendiente: "bg-[rgba(138,138,148,0.14)] text-[#8a8a94] border-[rgba(138,138,148,0.24)]",
  vencido: "bg-[rgba(227,227,234,0.12)] text-[#e3e3ea] border-[rgba(227,227,234,0.28)]",
  conciliado: "bg-[rgba(200,200,210,0.14)] text-[#c8c8d2] border-[rgba(200,200,210,0.24)]",
  duplicado: "bg-[rgba(138,138,148,0.1)] text-[#8a8a94] border-[rgba(138,138,148,0.2)]",
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
