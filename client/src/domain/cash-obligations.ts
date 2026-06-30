/**
 * Plan 1 — Obligaciones de CAJA sin doble-conteo (octopus-finance).
 * Una suscripción pagada con tarjeta NO es salida de caja individual: la salida de caja es el PAGO
 * de la tarjeta. Entonces:
 *  - incluir compromisos pendientes que NO son de tarjeta y NO son placeholders de pago de tarjeta;
 *  - reemplazar los placeholders fijos por el pago REAL de cada tarjeta (de buildCardDebt);
 *  - avisar (no romper) si una tarjeta no tiene estado de cuenta cargado.
 * Helper PURO: asOf se inyecta. Diseño revisado por Codex.
 */
import type { CommitmentInstance, Account } from "@shared/schema";
import type { CardDebt } from "./debt";

const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const cap = (n: unknown) => Number(n) || 0;

// Placeholders legacy de "pago de tarjeta" (allowlist exacta; texto/categoría es frágil, pero es legacy).
const PLACEHOLDER_CATEGORIES = new Set(["t.c pancho", "t.c javi"]);

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
  cardBreakdown: { last4: string; label: string; amount: number; workspace: string; deudaUsd?: number | null }[];
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
      .map((o) => ({ last4: o.meta?.last4 ?? "", label: o.label, amount: o.amount, workspace: o.workspace, deudaUsd: o.meta?.deudaUsd ?? null }));
    return {
      monthKey: mk, total: cash + card, cash, card,
      byWorkspace: Array.from(wsMap.entries()).map(([workspace, total]) => ({ workspace, total })).sort((a, b) => b.total - a.total),
      cardBreakdown,
    };
  });

  const cash = obligations.filter((o) => o.kind === "commitment").reduce((s, o) => s + o.amount, 0);
  const card = obligations.filter((o) => o.kind === "card_payment").reduce((s, o) => s + o.amount, 0);
  return { obligations, byMonth, warnings, totals: { cash, card, total: cash + card }, excluded: { cardCommitments, placeholders } };
}
