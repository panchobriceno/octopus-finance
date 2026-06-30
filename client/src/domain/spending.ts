/**
 * Análisis de gastos: gasto del mes por categoría / ámbito / comercio + tendencia mensual.
 * Puro (monthKey y monthsBack inyectados, sin new Date). Usa la lógica canónica de gasto.
 */
import { getTransactionExpenseImpact, isExecutedTransaction, normalizeTransaction } from "@/lib/finance";
import type { Transaction } from "@shared/schema";

/** "2026-06" + delta meses → "YYYY-MM" (aritmética sobre el string, sin Date). */
export function addMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Gasto económico real: no cancelado, ejecutado, y movementType expense (excluye transfer,
 * credit_card_payment, income y lo generado desde pagos de cliente). */
function expenseAmount(tx: Transaction): number {
  if ((tx.status ?? "paid") === "cancelled") return 0;
  if (!isExecutedTransaction(tx)) return 0;
  return getTransactionExpenseImpact(tx);
}

export type NamedAmount = { name: string; monto: number };
export type SpendingAnalysis = {
  monthKey: string;
  totalMes: number;
  byCategory: { categoria: string; monto: number }[];
  byWorkspace: { workspace: string; monto: number }[];
  topMerchants: NamedAmount[];
  trend: { monthKey: string; monto: number }[];
};

export function buildSpendingAnalysis(
  transactions: Transaction[],
  opts: { monthKey: string; monthsBack?: number },
): SpendingAnalysis {
  const monthKey = opts.monthKey;
  const monthsBack = opts.monthsBack ?? 6;
  const monthOf = (t: Transaction) => String(t.date).slice(0, 7);

  const monthTx = transactions.filter((t) => monthOf(t) === monthKey && expenseAmount(t) > 0);

  const cat = new Map<string, number>();
  const ws = new Map<string, number>();
  const merch = new Map<string, number>();
  let totalMes = 0;
  for (const t of monthTx) {
    const a = expenseAmount(t);
    totalMes += a;
    cat.set(t.category || "Otros", (cat.get(t.category || "Otros") || 0) + a);
    const w = normalizeTransaction(t).workspace || "family";
    ws.set(w, (ws.get(w) || 0) + a);
    merch.set(t.name || "—", (merch.get(t.name || "—") || 0) + a);
  }

  const sortDesc = (m: Map<string, number>) =>
    Array.from(m.entries()).sort((x, y) => y[1] - x[1]);

  const byCategory = sortDesc(cat).map(([categoria, monto]) => ({ categoria, monto }));
  const byWorkspace = sortDesc(ws).map(([workspace, monto]) => ({ workspace, monto }));
  const topMerchants = sortDesc(merch).slice(0, 8).map(([name, monto]) => ({ name, monto }));

  const trend: { monthKey: string; monto: number }[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const mk = addMonthKey(monthKey, -i);
    const monto = transactions
      .filter((t) => monthOf(t) === mk)
      .reduce((s, t) => s + expenseAmount(t), 0);
    trend.push({ monthKey: mk, monto });
  }

  return { monthKey, totalMes, byCategory, byWorkspace, topMerchants, trend };
}
