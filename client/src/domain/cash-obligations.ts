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
  kind: "commitment" | "card_payment";
  meta?: { facturado?: number; pagado?: number; deudaUsd?: number | null; vencido?: boolean; last4?: string };
};

export function buildCashObligations(input: {
  commitments: CommitmentInstance[];
  cardDebts: CardDebt[];
  cardAccounts?: Account[];
  asOf: string;
  windowDays?: number;
}): {
  obligations: CashObligation[];
  warnings: string[];
  totals: { cash: number; card: number; total: number };
  excluded: { cardCommitments: { count: number; sum: number }; placeholders: { count: number; sum: number } };
} {
  const { asOf } = input;
  const windowDays = input.windowDays ?? 45;
  const inWindow = (date: string, allowOverdue = false) => {
    const d = daysBetween(date, asOf);
    return d <= windowDays && (allowOverdue || d >= -7);
  };

  // 1. Compromisos de CAJA: pendientes, NO tarjeta, NO placeholder, dentro de ventana.
  const cardCommitments = { count: 0, sum: 0 };
  const placeholders = { count: 0, sum: 0 };
  const cashObligations: CashObligation[] = [];
  for (const c of input.commitments) {
    if (c.status !== "pending" || !c.dueDate) continue;
    const amount = cap(c.expectedAmount);
    if (isCardPaymentPlaceholder(c)) { placeholders.count++; placeholders.sum += amount; continue; }
    if (isCardPaidCommitment(c)) { cardCommitments.count++; cardCommitments.sum += amount; continue; }
    if (amount <= 0 || !inWindow(c.dueDate)) continue;
    cashObligations.push({
      id: `commitment:${c.id}`, label: c.name, amount, dueDate: c.dueDate,
      daysUntilDue: daysBetween(c.dueDate, asOf), kind: "commitment",
    });
  }

  // 2. Pago REAL de cada tarjeta con deuda (reemplaza los placeholders). Incluye vencidas.
  const cardPayments: CashObligation[] = [];
  for (const d of input.cardDebts) {
    if (cap(d.pendienteReal) <= 0 || !d.pagarHasta) continue;
    if (!inWindow(d.pagarHasta, true)) continue;
    cardPayments.push({
      id: `card:${d.last4}`, label: `Pago T.C ${d.cardLabel || ""} ··${d.last4}`.trim(),
      amount: cap(d.pendienteReal), dueDate: d.pagarHasta, daysUntilDue: daysBetween(d.pagarHasta, asOf),
      kind: "card_payment",
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

  const obligations = [...cashObligations, ...cardPayments].sort((x, y) => x.dueDate.localeCompare(y.dueDate));
  const cash = cashObligations.reduce((s, o) => s + o.amount, 0);
  const card = cardPayments.reduce((s, o) => s + o.amount, 0);
  return { obligations, warnings, totals: { cash, card, total: cash + card }, excluded: { cardCommitments, placeholders } };
}
