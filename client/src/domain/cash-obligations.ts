/**
 * Plan 1 — Obligaciones de CAJA sin doble-conteo (octopus-finance).
 * Una suscripción pagada con tarjeta NO es salida de caja individual: la salida de caja es el PAGO
 * de la tarjeta. Entonces:
 *  - incluir compromisos pendientes que NO son de tarjeta y NO son placeholders de pago de tarjeta;
 *  - reemplazar los placeholders fijos por el pago REAL de cada tarjeta (de buildCardDebt);
 *  - avisar (no romper) si una tarjeta no tiene estado de cuenta cargado.
 * Helper PURO: asOf se inyecta. Diseño revisado por Codex.
 */
import type { CommitmentInstance, Account, Transaction, ClientPayment } from "@shared/schema";
import type { CardDebt } from "./debt";
import { clientPaymentToIncomeTransaction, normalizeTransaction } from "@/lib/finance";

const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const cap = (n: unknown) => Number(n) || 0;

// Placeholders legacy de "pago de tarjeta" (allowlist exacta; texto/categoría es frágil, pero es legacy).
const PLACEHOLDER_CATEGORIES = new Set(["t.c pancho", "t.c javi"]);
const LEGACY_PLANNED_CATEGORIES = new Set([
  "iva por pagar",
  "cuota tarjeta",
  "pago tarjeta",
  "pago tarjeta de credito",
  "t.c pancho",
  "t.c javi",
]);

function daysBetween(target: string, asOf: string): number {
  const a = new Date(`${target}T00:00:00Z`).getTime();
  const b = new Date(`${asOf}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.round((a - b) / 86400000);
}

export function isCardPaidCommitment(c: Pick<CommitmentInstance, "cardAccountId" | "paymentMethod">): boolean {
  return Boolean(c.cardAccountId) || c.paymentMethod === "credit_card";
}
export function isCardPaymentPlaceholder(c: Pick<CommitmentInstance, "category">): boolean {
  return PLACEHOLDER_CATEGORIES.has(norm(c.category));
}

export type CashObligation = {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
  daysUntilDue: number;
  monthKey: string;   // mes al que se imputa (vencidos caen en el mes actual)
  workspace: string;  // ambiente (empresa / familia / compartida)
  kind: "commitment" | "card_payment";
  meta?: { facturado?: number; pagado?: number; deudaUsd?: number | null; vencido?: boolean; last4?: string };
};

export type MonthSummary = {
  monthKey: string;
  total: number;
  cash: number;
  card: number;
  byWorkspace: { workspace: string; total: number }[];
  cardBreakdown: { last4: string; label: string; amount: number; workspace: string; deudaUsd?: number | null; overdue: boolean }[];
  cashBreakdown: { label: string; amount: number; workspace: string; dueDate: string; overdue: boolean }[];
};

function addMonthKey(monthKey: string, n: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m - 1) + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildCashObligations(input: {
  commitments: CommitmentInstance[];
  cardDebts: CardDebt[];
  cardAccounts?: Account[];
  asOf: string;
  monthsAhead?: number; // cuántos meses incluir desde el actual (default 3 = este + 2 siguientes)
}): {
  obligations: CashObligation[];
  byMonth: MonthSummary[];
  warnings: string[];
  totals: { cash: number; card: number; total: number };
  excluded: { cardCommitments: { count: number; sum: number }; placeholders: { count: number; sum: number } };
} {
  const { asOf } = input;
  const monthsAhead = input.monthsAhead ?? 3;
  const currentMonth = asOf.slice(0, 7);
  const lastMonth = addMonthKey(currentMonth, monthsAhead - 1);
  // Imputa una fecha a un mes del rango: vencidos (mes < actual) caen en el mes ACTUAL; fuera del rango → null.
  const bucket = (date: string): string | null => {
    const mk = String(date).slice(0, 7);
    if (mk < currentMonth) return currentMonth; // vencido pendiente → lo debo ahora
    if (mk > lastMonth) return null;
    return mk;
  };

  // Mapa last4 → cuenta-tarjeta (para ambiente del pago de tarjeta).
  const cardByLast4 = new Map<string, Account>();
  for (const a of input.cardAccounts ?? []) {
    if (a.type !== "credit_card") continue;
    const l4 = digits(a.accountNumber).slice(-4);
    if (l4.length === 4) cardByLast4.set(l4, a);
  }

  // 1. Compromisos de CAJA: pendientes, NO tarjeta, NO placeholder, dentro del rango.
  const cardCommitments = { count: 0, sum: 0 };
  const placeholders = { count: 0, sum: 0 };
  const obligations: CashObligation[] = [];
  for (const c of input.commitments) {
    if (c.status !== "pending" || !c.dueDate) continue;
    const amount = cap(c.expectedAmount);
    if (isCardPaymentPlaceholder(c)) { placeholders.count++; placeholders.sum += amount; continue; }
    if (isCardPaidCommitment(c)) { cardCommitments.count++; cardCommitments.sum += amount; continue; }
    const mk = bucket(c.dueDate);
    if (amount <= 0 || !mk) continue;
    obligations.push({
      id: `commitment:${c.id}`, label: c.name, amount, dueDate: c.dueDate,
      daysUntilDue: daysBetween(c.dueDate, asOf), monthKey: mk,
      workspace: (c.workspace as string) || "business", kind: "commitment",
    });
  }

  // 2. Pago REAL de cada tarjeta con deuda (reemplaza los placeholders). Incluye vencidas.
  for (const d of input.cardDebts) {
    if (cap(d.pendienteReal) <= 0 || !d.pagarHasta) continue;
    const mk = bucket(d.pagarHasta);
    if (!mk) continue;
    const acc = cardByLast4.get(d.last4);
    obligations.push({
      id: `card:${d.last4}`, label: `Pago ${acc?.name || d.cardLabel || `T.C ··${d.last4}`}`,
      amount: cap(d.pendienteReal), dueDate: d.pagarHasta, daysUntilDue: daysBetween(d.pagarHasta, asOf),
      monthKey: mk, workspace: (acc?.workspace as string) || "shared", kind: "card_payment",
      meta: { facturado: cap(d.montoFacturado), pagado: cap(d.pagado), deudaUsd: d.deudaInternacionalUsd ?? null, vencido: d.vencido, last4: d.last4 },
    });
  }

  // 3. Avisos: tarjetas sin estado de cuenta cargado → su pago no se puede calcular.
  const debtLast4 = new Set(input.cardDebts.map((d) => d.last4));
  const warnings: string[] = [];
  for (const a of input.cardAccounts ?? []) {
    if (a.type !== "credit_card") continue;
    const l4 = digits(a.accountNumber).slice(-4);
    if (l4.length === 4 && !debtLast4.has(l4)) warnings.push(`Sin estado de cuenta cargado: ${a.name} — no puedo calcular su pago de tarjeta.`);
  }

  obligations.sort((x, y) => x.dueDate.localeCompare(y.dueDate));

  // 4. Resumen por mes (con desglose por ambiente y por tarjeta para el hover).
  const months: string[] = [];
  for (let i = 0; i < monthsAhead; i++) months.push(addMonthKey(currentMonth, i));
  const byMonth: MonthSummary[] = months.map((mk) => {
    const inMonth = obligations.filter((o) => o.monthKey === mk);
    const cash = inMonth.filter((o) => o.kind === "commitment").reduce((s, o) => s + o.amount, 0);
    const card = inMonth.filter((o) => o.kind === "card_payment").reduce((s, o) => s + o.amount, 0);
    const wsMap = new Map<string, number>();
    for (const o of inMonth) wsMap.set(o.workspace, (wsMap.get(o.workspace) ?? 0) + o.amount);
    const cardBreakdown = inMonth
      .filter((o) => o.kind === "card_payment")
      .map((o) => ({ last4: o.meta?.last4 ?? "", label: o.label, amount: o.amount, workspace: o.workspace, deudaUsd: o.meta?.deudaUsd ?? null, overdue: o.daysUntilDue < 0 }));
    const cashBreakdown = inMonth
      .filter((o) => o.kind === "commitment")
      .map((o) => ({ label: o.label, amount: o.amount, workspace: o.workspace, dueDate: o.dueDate, overdue: o.daysUntilDue < 0 }))
      .sort((a, b) => b.amount - a.amount);
    return {
      monthKey: mk, total: cash + card, cash, card,
      byWorkspace: Array.from(wsMap.entries()).map(([workspace, total]) => ({ workspace, total })).sort((a, b) => b.total - a.total),
      cardBreakdown, cashBreakdown,
    };
  });

  const cash = obligations.filter((o) => o.kind === "commitment").reduce((s, o) => s + o.amount, 0);
  const card = obligations.filter((o) => o.kind === "card_payment").reduce((s, o) => s + o.amount, 0);
  return { obligations, byMonth, warnings, totals: { cash, card, total: cash + card }, excluded: { cardCommitments, placeholders } };
}

/**
 * Convierte las obligaciones de caja (mismo motor que el asesor) en transacciones SINTÉTICAS
 * planificadas, para que Flujo de Caja proyecte EXACTAMENTE lo mismo que el asesor (sin doble-conteo).
 * Vencidos se imputan a `asOf` (igual que buildCashObligations los pone en el mes actual).
 */
export function buildObligationProjectionTransactions(input: {
  commitments: CommitmentInstance[];
  cardDebts: CardDebt[];
  cardAccounts?: Account[];
  asOf: string;
  monthsAhead?: number;
}): Transaction[] {
  const co = buildCashObligations({ ...input, monthsAhead: input.monthsAhead ?? 12 });
  return co.obligations.map((o) => {
    const overdue = o.daysUntilDue < 0;
    const date = overdue ? input.asOf : o.dueDate; // vencido → hoy (como el asesor lo imputa al mes actual)
    const isCard = o.kind === "card_payment";
    return {
      id: `obligation-${o.id}`,
      name: o.label,
      category: isCard ? "Pago Tarjeta" : "Compromiso",
      amount: o.amount,
      type: "expense",
      date,
      notes: overdue ? `Vencía ${o.dueDate}` : null,
      subtype: "planned",
      status: "pending",
      itemId: null,
      workspace: o.workspace,
      movementType: isCard ? "credit_card_payment" : "expense",
      paymentMethod: "bank_account",
      destinationWorkspace: null,
      destinationAccountId: null,
      creditCardName: null,
      cardAccountId: null,
      installmentCount: null,
      accountId: null,
      sourceClientPaymentId: null,
    } satisfies Transaction;
  });
}

/**
 * Universo de transacciones para Flujo de Caja: SOLO lo real (no planned) + ingresos cliente (NETO)
 * + obligaciones (commitments + pago de tarjeta de cartola). NO incluye cuotas proyectadas de tarjeta
 * (el pago real viene de la cartola) ni planned legacy/manual → evita doble-conteo. Misma fuente que el asesor.
 * Modelo IVA (decisión del dueño): la caja se mueve en NETO; el IVA NO entra al flujo (iba doble-restado
 * sobre el ingreso ya neteado). El IVA se informa aparte (tarjeta "IVA a separar" + Resumen).
 */
export function buildCashFlowFinancialTransactions(input: {
  transactions: Transaction[];
  clientPayments: ClientPayment[];
  commitments: CommitmentInstance[];
  cardDebts: CardDebt[];
  cardAccounts?: Account[];
  asOf: string;
  monthsAhead?: number;
  includeManualPlanned?: boolean;
}): Transaction[] {
  const base = input.transactions.filter((t) => (t.subtype ?? "actual") !== "planned");
  const manualPlanned = input.includeManualPlanned
    ? input.transactions.filter(isManualPlannedReportingTransaction)
    : [];
  const income = input.clientPayments
    .map(clientPaymentToIncomeTransaction)
    .filter((t): t is Transaction => t !== null);
  const obligations = buildObligationProjectionTransactions({
    commitments: input.commitments,
    cardDebts: input.cardDebts,
    cardAccounts: input.cardAccounts,
    asOf: input.asOf,
    monthsAhead: input.monthsAhead,
  });
  return [...base, ...manualPlanned, ...income, ...obligations];
}

function isManualPlannedReportingTransaction(tx: Transaction) {
  const normalized = normalizeTransaction(tx);
  if (normalized.subtype !== "planned" || normalized.status === "cancelled") return false;
  if (
    normalized.sourceClientPaymentId ||
    normalized.sourceCommitmentInstanceId ||
    normalized.sourceCommitmentTemplateId ||
    normalized.importBatchId
  ) {
    return false;
  }
  if (String(normalized.id).startsWith("obligation-") || String(normalized.id).startsWith("client-payment-")) {
    return false;
  }
  const category = norm(normalized.category);
  const name = norm(normalized.name);
  if (LEGACY_PLANNED_CATEGORIES.has(category)) return false;
  if (/^cuota\s+\d+\s*\/\s*\d+/.test(name)) return false;
  if (normalized.movementType === "credit_card_payment") return false;
  return true;
}
