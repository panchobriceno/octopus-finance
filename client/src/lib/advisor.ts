/**
 * Asesor IA — capa de datos. El CÓDIGO es dueño de los números y fechas (fuente de verdad);
 * la IA solo prioriza, explica y alerta referenciando los "id" de estos hechos.
 * El endpoint /api/advisor es read-only (nunca escribe). Ver server/routes.ts.
 */
import type {
  ClientPayment,
  CommitmentInstance,
  CreditCardSetting,
  ImportBatch,
  ImportedMovement,
  Transaction,
} from "@shared/schema";

const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const monthKeyOf = (d: string) => (d || "").slice(0, 7);
const prevMonthKey = (mk: string) => { const [y, m] = mk.split("-").map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export type Obligation = { id: string; label: string; amount: number; dueDate: string; daysUntilDue: number; cuenta: string | null };
export type IncomeFact = { id: string; label: string; amount: number; expectedDate: string };
export type MissingDoc = { id: string; texto: string };
export type CategoryDelta = { categoria: string; mesActual: number; mesAnterior: number; delta: number };

export type AdvisorFacts = {
  asOf: string;
  obligations: Obligation[];
  upcomingIncome: IncomeFact[];
  review: { pendingMovements: number; oldestPendingDate: string | null };
  missingDocs: MissingDoc[];
  categoryDeltas: CategoryDelta[];
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
}): AdvisorFacts {
  const now = today();
  const cap = (n: number) => Number(n) || 0;

  // Obligaciones: compromisos pendientes con vencimiento entre hace 7 días y dentro de 45.
  const obligations: Obligation[] = input.commitments
    .filter((c) => c.status === "pending" && c.dueDate)
    .map((c) => ({ id: `commitment:${c.id}`, label: c.name, amount: cap(c.expectedAmount), dueDate: c.dueDate, daysUntilDue: daysBetween(c.dueDate, now), cuenta: c.creditCardName ?? c.accountId ?? null }))
    .filter((o) => o.daysUntilDue >= -7 && o.daysUntilDue <= 45 && o.amount > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // Ingresos esperados de clientes (no liquidados) en los próximos 60 días.
  const upcomingIncome: IncomeFact[] = input.clientPayments
    .filter((p) => (p.status ?? "") !== "paid" && (p.status ?? "") !== "cancelled")
    .map((p) => ({ id: `income:${p.id}`, label: p.clientName || "Pago de cliente", amount: cap(p.totalAmount), expectedDate: p.expectedDate || p.dueDate || "" }))
    .filter((i) => i.expectedDate && i.amount > 0 && daysBetween(i.expectedDate, now) >= -7 && daysBetween(i.expectedDate, now) <= 60)
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  // Documentos faltantes: por cada tarjeta activa, ¿hay un EECC reciente (≤35 días)?
  const missingDocs: MissingDoc[] = [];
  const eeccBatches = input.importBatches.filter(isEeccBatch);
  for (const card of input.creditCards.filter((c) => c.isActive !== false)) {
    const forCard = eeccBatches.filter((b) => (b.creditCardName ?? "") === card.cardName);
    const latest = forCard.map((b) => b.periodEnd || b.createdAt).filter(Boolean).sort().slice(-1)[0];
    if (!latest || daysBetween(now, latest) > 35) {
      missingDocs.push({ id: `missingdoc:eecc:${card.cardName}`, texto: latest ? `Falta el estado de cuenta (EECC) reciente de ${card.cardName} (el último es del ${latest}).` : `Nunca se cargó un estado de cuenta (EECC) de ${card.cardName}.` });
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

  return { asOf: now, obligations, upcomingIncome, review, missingDocs, categoryDeltas };
}

export async function fetchAdvisor(facts: AdvisorFacts): Promise<AdvisorReport> {
  const res = await fetch("/api/advisor", {
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
