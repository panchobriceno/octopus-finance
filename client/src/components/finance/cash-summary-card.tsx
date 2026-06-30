import { useState } from "react";
import { Info, CreditCard } from "lucide-react";
import { formatCLP } from "@/lib/utils";
import type { MonthSummary } from "@/domain/cash-obligations";

const LIME = "#cdfa46";
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WS_LABEL: Record<string, string> = { business: "Empresa", family: "Familia", shared: "Compartida", dentist: "Dentista" };
const monthLabel = (mk: string) => { const [y, m] = mk.split("-").map(Number); return `${MESES[(m - 1) % 12]} ${String(y).slice(2)}`; };

/**
 * Tarjeta resumen "A pagar" (Plan 1): cuánto pagar este mes + los 2 siguientes, por ambiente.
 * El (i) despliega el desglose por tarjeta (cómo se reparte el pago de tarjetas).
 * Es FLUJO del mes (cuota/facturado del ciclo), no el saldo total de deuda.
 */
export function CashSummaryCard({ months }: { months: MonthSummary[] }) {
  const [sel, setSel] = useState(0);
  const [showCards, setShowCards] = useState(false);
  if (!months.length) return null;
  const m = months[Math.min(sel, months.length - 1)];

  return (
    <div
      className="relative overflow-hidden rounded-[22px] border border-[#24242e] p-[18px] sm:p-[22px_24px]"
      style={{ background: "linear-gradient(135deg,#15151d 0%,#101016 100%)" }}
      data-testid="card-cash-summary"
    >
      <div className="pointer-events-none absolute -right-8 -top-16 size-56 rounded-full" style={{ background: "radial-gradient(circle,rgba(205,250,70,.07),transparent 70%)" }} />

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[9.5px] font-bold tracking-[.12em] sm:text-[10.5px]" style={{ color: LIME }}>A PAGAR</span>
        <div className="flex gap-1">
          {months.map((mm, i) => (
            <button
              key={mm.monthKey}
              onClick={() => setSel(i)}
              className="rounded-full px-2.5 py-[3px] text-[10.5px] font-bold capitalize transition-colors"
              style={i === sel
                ? { color: "#0d0d12", background: LIME }
                : { color: "#8a8a96", background: "rgba(255,255,255,.04)", border: "1px solid #24242e" }}
              data-testid={`tab-month-${mm.monthKey}`}
            >
              {monthLabel(mm.monthKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="font-mono text-[30px] font-bold tabular-nums text-[#f4f4f7] sm:text-[38px]" data-testid="text-month-total">
        {formatCLP(m.total)}
      </div>

      {/* caja + tarjetas (con toggle de desglose) */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
        <span className="text-[#8a8a96]">Cuentas <b className="font-semibold text-[#e3e3ea]">{formatCLP(m.cash)}</b></span>
        <button
          onClick={() => setShowCards((v) => !v)}
          className="flex items-center gap-1 text-[#8a8a96] hover-elevate rounded-md px-1"
          data-testid="button-toggle-card-breakdown"
        >
          Tarjetas <b className="font-semibold text-[#e3e3ea]">{formatCLP(m.card)}</b>
          <Info className="size-3.5" style={{ color: LIME }} />
        </button>
      </div>

      {/* desglose por tarjeta */}
      {showCards && (
        <div className="mt-3 space-y-1.5 rounded-xl border border-[#24242e] bg-[rgba(0,0,0,.18)] p-3" data-testid="list-card-breakdown">
          {m.cardBreakdown.length === 0 ? (
            <p className="text-[12px] text-[#8a8a96]">Sin pagos de tarjeta este mes.</p>
          ) : m.cardBreakdown.map((c) => (
            <div key={c.last4} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="flex min-w-0 items-center gap-1.5 text-[#cfcfd8]">
                <CreditCard className="size-3.5 shrink-0 text-[#8a8a96]" />
                <span className="truncate">{c.label}</span>
                <span className="shrink-0 text-[10px] text-[#6a6a76]">{WS_LABEL[c.workspace] ?? c.workspace}</span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-[#e3e3ea]">
                {formatCLP(c.amount)}{c.deudaUsd ? <span className="ml-1 text-[10.5px] text-[#c8a24a]">+US${c.deudaUsd}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* por ambiente */}
      {m.byWorkspace.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.byWorkspace.map((w) => (
            <span key={w.workspace} className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ color: "#cfcfd8", background: "rgba(255,255,255,.04)", border: "1px solid #24242e" }}>
              {WS_LABEL[w.workspace] ?? w.workspace}: <b className="font-mono tabular-nums text-[#f4f4f7]">{formatCLP(w.total)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
