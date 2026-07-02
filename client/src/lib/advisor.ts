/**
 * Asesor IA — capa de datos. El CÓDIGO es dueño de los números y fechas (fuente de verdad);
 * la IA solo prioriza, explica y alerta referenciando los "id" de estos hechos.
 * El endpoint /api/advisor es read-only (nunca escribe). Ver server/routes.ts.
 */
import { authedFetch } from "@/lib/api";
import type {
  Account,
  ClientPayment,
  CommitmentInstance,
  CreditCardSetting,
  CreditCardStatement,
  ImportBatch,
  ImportedMovement,
  Transaction,
} from "@shared/schema";
import { buildCardDebt } from "@/domain/debt";
import { buildCashObligations, type MonthSummary } from "@/domain/cash-obligations";
import { getTodayLocalDateKey } from "@/lib/finance";

const DAY = 86400000;
const today = () => getTodayLocalDateKey();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const monthKeyOf = (d: string) => (d || "").slice(0, 7);
const prevMonthKey = (mk: string) => { const [y, m] = mk.split("-").map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export type Obligation = { id: string; label: string; amount: number; dueDate: string; daysUntilDue: number; cuenta: string | null };
export type IncomeFact = { id: string; label: string; amount: number; expectedDate: string };
export type MissingDoc = { id: string; texto: string };
export type CategoryDelta = { categoria: string; mesActual: number; mesAnterior: number; delta: number };
export type DupTx = { id: string; date: string; name: string; amount: number; category: string; source: string };
export type DuplicatePair = { a: DupTx; b: DupTx };

export type AdvisorFacts = {
  asOf: string;
  obligations: Obligation[];
  obligationsByMonth: MonthSummary[];
  cardWarnings: string[];
  upcomingIncome: IncomeFact[];
  review: { pendingMovements: number; oldestPendingDate: string | null };
  missingDocs: MissingDoc[];
  categoryDeltas: CategoryDelta[];
  duplicates: DuplicatePair[];
};

export type AdvisorReport = {
  resumen: string;
  alertas: { texto: string; severidad?: string }[];
  pagar: { sourceId: string; prioridad?: string; razon?: string }[];
  revisar: { texto: string; sourceId?: string }[];
  generatedAt: string;
};

/** Detecta un lote EECC (estado de cuenta de tarjeta) en los importBatches. */
function isEeccBatch(b: ImportBatch): boolean {
  const s = `${b.source ?? ""} ${b.sourceName ?? ""} ${b.notes ?? ""}`.toLowerCase();
  return b.sourceType === "credit_card" && (s.includes("eecc") || s.includes("estado de cuenta") || b.source === "pdf");
}

export function buildAdvisorFacts(input: {
  commitments: CommitmentInstance[];
  clientPayments: ClientPayment[];
  importBatches: ImportBatch[];
  creditCards: CreditCardSetting[];
  pendingMovements: ImportedMovement[];
  transactions: Transaction[];
  accounts?: Account[];
  creditCardStatements?: CreditCardStatement[];
}): AdvisorFacts {
  const now = today();
  const cap = (n: number) => Number(n) || 0;

  // Obligaciones SIN doble-conteo (Plan 1): caja (cuentas) + pago REAL de tarjetas del ciclo,
  // excluyendo las suscripciones de tarjeta y los placeholders fijos. Rango: este mes + 2.
  const accounts = input.accounts ?? [];
  const cardDebts = buildCardDebt(input.creditCardStatements ?? [], input.transactions, accounts, { asOf: now });
  const cashObs = buildCashObligations({
    commitments: input.commitments,
    cardDebts,
    cardAccounts: accounts.filter((a) => a.type === "credit_card"),
    asOf: now,
    monthsAhead: 3,
  });
  const obligations: Obligation[] = cashObs.obligations.map((o) => ({
    id: o.id, label: o.label, amount: o.amount, dueDate: o.dueDate, daysUntilDue: o.daysUntilDue, cuenta: o.workspace,
  }));

  // Ingresos esperados de clientes (no liquidados) en los próximos 60 días.
  const upcomingIncome: IncomeFact[] = input.clientPayments
    .filter((p) => (p.status ?? "") !== "paid" && (p.status ?? "") !== "cancelled")
    .map((p) => ({ id: `income:${p.id}`, label: p.clientName || "Pago de cliente", amount: cap(p.totalAmount), expectedDate: p.expectedDate || p.dueDate || "" }))
    .filter((i) => i.expectedDate && i.amount > 0 && daysBetween(i.expectedDate, now) >= -7 && daysBetween(i.expectedDate, now) <= 60)
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  // Documentos faltantes: SOLO marcamos tarjetas que YA tuvieron un EECC antes (así sabemos que
  // reciben estado de cuenta) y cuyo último EECC está atrasado (>35 días). "Nunca tuvo EECC" NO
  // se marca: muchas entradas son cuentas corrientes o tarjetas de terceros sin EECC mensual.
  const missingDocs: MissingDoc[] = [];
  const eeccBatches = input.importBatches.filter(isEeccBatch);
  for (const card of input.creditCards.filter((c) => c.isActive !== false)) {
    const forCard = eeccBatches.filter((b) => (b.creditCardName ?? "") === card.cardName);
    if (forCard.length === 0) continue; // sin historial de EECC -> no asumimos que falta
    const latest = forCard.map((b) => b.periodEnd || b.createdAt).filter(Boolean).sort().slice(-1)[0];
    if (latest && daysBetween(now, latest) > 35) {
      missingDocs.push({ id: `missingdoc:eecc:${card.cardName}`, texto: `Falta el estado de cuenta (EECC) reciente de ${card.cardName} (el último es del ${latest}).` });
    }
  }

  // Movimientos por revisar.
  const pend = input.pendingMovements.filter((m) => m.status === "pending");
  const oldest = pend.map((m) => m.date).filter(Boolean).sort()[0] ?? null;
  const review = { pendingMovements: pend.length, oldestPendingDate: oldest };

  // Cambios de gasto: mes actual vs anterior por categoría (top 5 movimientos al alza).
  const mkNow = monthKeyOf(now);
  const mkPrev = prevMonthKey(mkNow);
  const byCat = (mk: string) => { const m = new Map<string, number>(); for (const t of input.transactions) { if ((t.type ?? "expense") !== "expense") continue; if ((t.movementType ?? "expense") === "transfer") continue; if (monthKeyOf(t.date) !== mk) continue; m.set(t.category || "Sin categoría", (m.get(t.category || "Sin categoría") ?? 0) + cap(t.amount)); } return m; };
  const cur = byCat(mkNow); const prev = byCat(mkPrev);
  const cats = new Set<string>();
  cur.forEach((_v, k) => cats.add(k));
  prev.forEach((_v, k) => cats.add(k));
  const categoryDeltas: CategoryDelta[] = Array.from(cats)
    .map((categoria) => ({ categoria, mesActual: cur.get(categoria) ?? 0, mesAnterior: prev.get(categoria) ?? 0, delta: (cur.get(categoria) ?? 0) - (prev.get(categoria) ?? 0) }))
    .filter((d) => Math.abs(d.delta) >= 20000)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);

  // Posibles duplicados de TRANSACCIONES (alta confianza, para acción de borrar): mismo monto +
  // mismo tipo + fechas ≤5 días + MISMA categoría + token de nombre significativo compartido.
  // Estricto a propósito (es destructivo): no sugerir borrar un gasto recurrente legítimo.
  const normTxt = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const GENERIC = new Set(["pago", "pagos", "linea", "transferencia", "transf", "compra", "compras", "web", "online", "nacional", "automatico", "automatica", "cuenta", "banco", "abono", "cargo", "servicio", "mensual", "transf."]);
  const nameTokens = (s: string) => normTxt(s).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !GENERIC.has(w));
  const liteTx = (t: Transaction): DupTx => ({ id: t.id, date: t.date, name: (t as any).name ?? "", amount: cap(t.amount), category: t.category || "Sin categoría", source: (t as any).importBatchLabel ?? t.creditCardName ?? t.accountId ?? "manual" });
  const groups = new Map<string, Transaction[]>();
  for (const t of input.transactions) {
    if ((t.status ?? "paid") === "cancelled") continue;
    if ((t.movementType ?? "") === "transfer") continue; // traspasos no son duplicados de gasto/ingreso
    const k = `${Math.round(cap(t.amount))}|${t.type ?? "expense"}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  const duplicates: DuplicatePair[] = [];
  for (const list of Array.from(groups.values())) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (Math.abs(daysBetween(a.date, b.date)) > 5) continue;
        if (normTxt(a.category) !== normTxt(b.category)) continue;
        const ta = new Set(nameTokens((a as any).name ?? ""));
        if (!nameTokens((b as any).name ?? "").some((w) => ta.has(w))) continue;
        duplicates.push({ a: liteTx(a), b: liteTx(b) });
      }
    }
  }

  return { asOf: now, obligations, obligationsByMonth: cashObs.byMonth, cardWarnings: cashObs.warnings, upcomingIncome, review, missingDocs, categoryDeltas, duplicates: duplicates.slice(0, 8) };
}

/** Resuelve un duplicado: borra la transacción elegida y descarta su movimiento de origen.
 *  (la mutación real vive en lib/firestore.ts; acá solo el tipo del resultado). */
export type ResolveDuplicateResult = { deletedTransactionId: string; revertedMovementId: string | null };

export async function fetchAdvisor(facts: AdvisorFacts): Promise<AdvisorReport> {
  const res = await authedFetch("/api/advisor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ facts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || `Error ${res.status} del asesor.`);
  }
  const data = await res.json();
  return {
    resumen: typeof data.resumen === "string" ? data.resumen : "",
    alertas: Array.isArray(data.alertas) ? data.alertas : [],
    pagar: Array.isArray(data.pagar) ? data.pagar : [],
    revisar: Array.isArray(data.revisar) ? data.revisar : [],
    generatedAt: new Date().toISOString(),
  };
}
