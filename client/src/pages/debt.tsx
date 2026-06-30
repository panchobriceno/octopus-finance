import { useMemo } from "react";
import { CreditCard, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCLP } from "@/lib/utils";
import { useCreditCardStatements, useTransactions, useAccounts } from "@/lib/hooks";
import { buildCardDebt, type CardDebt } from "@/domain/debt";

const LIME = "#cdfa46";
const USD_CLP = 960; // tipo de cambio referencial para mostrar la deuda en dólares en pesos
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fmtDate = (s: string) => {
  const m = (s || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1] ?? m[2]}` : s;
};
const todayLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function CardRow({ d }: { d: CardDebt }) {
  const dueDays = (() => {
    const m = (d.pagarHasta || "").match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const t = new Date(todayLocal());
    return Math.round((due.getTime() - t.getTime()) / 86_400_000);
  })();
  const dueLabel = dueDays == null ? "" : dueDays < 0 ? `venció hace ${Math.abs(dueDays)}d` : dueDays === 0 ? "vence hoy" : `en ${dueDays}d`;
  const dueCls = dueDays != null && dueDays <= 3 ? "text-red-400" : "text-[#9a9aa6]";
  const cupoPct = d.cupoTotal && d.cupoUtilizado != null ? Math.min(100, Math.round((d.cupoUtilizado / d.cupoTotal) * 100)) : null;
  const usdClp = Math.round((d.deudaInternacionalUsd || 0) * USD_CLP);
  const totalCard = d.pendienteReal + usdClp; // pendiente real incluyendo la deuda en dólares

  return (
    <Card className="border-card-border bg-secondary">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg border border-card-border bg-background/40 text-[#cdfa46]"><CreditCard className="size-4" /></span>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{d.cardLabel}</div>
                <div className="text-xs text-[#9a9aa6]">Estado {d.statementMonthKey} · vence {fmtDate(d.pagarHasta)} <span className={dueCls}>({dueLabel})</span></div>
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-2xl font-extrabold tabular-nums" style={{ color: totalCard > 0 ? "#f4f4f7" : LIME }}>{formatCLP(totalCard)}</div>
            <div className="text-[11px] text-[#9a9aa6]">pendiente real{usdClp > 0 ? " (nacional + dólares)" : ""}</div>
          </div>
        </div>

        {/* desglose facturado − pagado */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-card-border bg-background/40 px-2 py-2">
            <div className="text-[10px] text-[#9a9aa6]">Facturado</div>
            <div className="font-mono text-sm font-bold tabular-nums">{formatCLP(d.montoFacturado)}</div>
          </div>
          <div className="rounded-lg border border-card-border bg-background/40 px-2 py-2">
            <div className="text-[10px] text-[#9a9aa6]">Ya pagado</div>
            <div className="font-mono text-sm font-bold tabular-nums" style={{ color: d.pagado > 0 ? LIME : undefined }}>{d.pagado > 0 ? `−${formatCLP(d.pagado)}` : "—"}</div>
          </div>
          <div className="rounded-lg border border-card-border bg-background/40 px-2 py-2">
            <div className="text-[10px] text-[#9a9aa6]">Mínimo</div>
            <div className="font-mono text-sm font-bold tabular-nums">{d.montoMinimo != null ? formatCLP(d.montoMinimo) : "—"}</div>
          </div>
        </div>

        {/* Deuda en dólares — destacada (no puede pasar desapercibida) */}
        {usdClp > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <span className="flex items-center gap-2 text-[13px] font-bold text-amber-300"><DollarSign className="size-4" /> Deuda en dólares</span>
            <span className="text-right">
              <span className="font-mono text-base font-extrabold text-amber-300">US${(d.deudaInternacionalUsd ?? 0).toFixed(2)}</span>
              <span className="ml-2 font-mono text-xs text-amber-400/80">≈ {formatCLP(usdClp)}</span>
            </span>
          </div>
        )}

        {/* pagos post-cierre */}
        {d.pagos.length > 0 && (
          <div className="mt-3 space-y-1">
            {d.pagos.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-[#9a9aa6]">Pago {fmtDate(p.date)} · {p.name}</span>
                <span className="font-mono tabular-nums" style={{ color: LIME }}>−{formatCLP(p.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* cupo */}
        {cupoPct != null && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[11px] text-[#9a9aa6]"><span>Cupo usado</span><span>{formatCLP(d.cupoUtilizado ?? 0)} / {formatCLP(d.cupoTotal ?? 0)}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full" style={{ width: `${cupoPct}%`, background: cupoPct >= 90 ? "#f87171" : LIME }} /></div>
          </div>
        )}

        {/* flags + intl + historial */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          {d.vencido && <span className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-red-400">plazo vencido</span>}
          {d.history.length > 1 && (
            <span className="text-[#9a9aa6]">Historial: {d.history.map((h) => `${h.statementMonthKey.slice(5)} ${formatCLP(h.montoFacturado)}`).join(" → ")}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DebtPage() {
  const statements = useCreditCardStatements();
  const transactions = useTransactions();
  const accounts = useAccounts();

  const debts = useMemo<CardDebt[]>(() => {
    if (!statements.data || !transactions.data || !accounts.data) return [];
    return buildCardDebt(statements.data, transactions.data, accounts.data, { asOf: todayLocal() });
  }, [statements.data, transactions.data, accounts.data]);

  const loading = !statements.data || !transactions.data || !accounts.data;
  const totalPendiente = debts.reduce((s, d) => s + d.pendienteReal, 0);
  const totalFacturado = debts.reduce((s, d) => s + d.montoFacturado, 0);
  const totalPagado = debts.reduce((s, d) => s + d.pagado, 0);
  const totalUsd = debts.reduce((s, d) => s + (d.deudaInternacionalUsd || 0), 0);
  const totalUsdClp = Math.round(totalUsd * USD_CLP);
  const totalConUsd = totalPendiente + totalUsdClp;

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl border border-card-border bg-secondary text-[#cdfa46]"><CreditCard className="size-4" /></span>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Centro de Deuda</h2>
          <p className="mt-0.5 text-xs text-[#9a9aa6]">Lo que debés de verdad: facturado menos lo que ya pagaste tras el cierre.</p>
        </div>
      </div>

      {/* total consolidado */}
      <Card className="border-card-border bg-secondary">
        <CardContent className="flex flex-wrap items-end justify-between gap-4 pt-5">
          <div>
            <div className="text-xs text-[#9a9aa6]">Deuda real de tarjetas (pendiente hoy)</div>
            <div className="font-mono text-3xl font-extrabold tabular-nums">{formatCLP(totalConUsd)}</div>
            {totalUsd > 0 && (
              <div className="mt-1 text-xs">
                <span className="text-[#9a9aa6]">nacional {formatCLP(totalPendiente)} + </span>
                <span className="font-bold text-amber-300">dólares US${totalUsd.toFixed(2)} (≈{formatCLP(totalUsdClp)})</span>
              </div>
            )}
          </div>
          <div className="text-right text-xs text-[#9a9aa6]">
            <div>Facturado: <span className="font-mono">{formatCLP(totalFacturado)}</span></div>
            <div>Ya pagado: <span className="font-mono" style={{ color: LIME }}>−{formatCLP(totalPagado)}</span></div>
          </div>
        </CardContent>
      </Card>

      {loading && <p className="text-center text-sm text-[#9a9aa6]">Cargando tu deuda…</p>}
      {!loading && debts.length === 0 && (
        <Card className="border-card-border bg-secondary"><CardContent className="pt-5 text-sm text-[#9a9aa6]">No hay estados de cuenta cargados todavía. Subí cartolas a la carpeta y se cargan al historial.</CardContent></Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {debts.map((d) => <CardRow key={d.cardKey} d={d} />)}
      </div>
    </div>
  );
}
