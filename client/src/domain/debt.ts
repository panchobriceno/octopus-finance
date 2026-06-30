/**
 * Centro de Deuda: por cada tarjeta toma el ÚLTIMO estado de cuenta y le NETEA los pagos
 * EJECUTADOS hechos después del cierre, para mostrar la deuda REAL (no la del papel).
 * Helper puro: `asOf` se inyecta (no usa new Date()). Revisado por Codex.
 */
import { isExecutedTransaction, normalizeTransaction } from "@/lib/finance";
import type { CreditCardStatement, Transaction, Account } from "@shared/schema";

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Código canónico de banco: el banco imprime su nombre distinto entre cartolas
 * (ej. "Banco Edwards" y "Banco de Chile" son el mismo). Agrupa por código + last4. */
export function bankCode(bank: unknown): string {
  const b = norm(bank);
  if (b.includes("edwards") || b.includes("chile")) return "bancochile";
  if (b.includes("santander")) return "santander";
  if (b.includes("itau")) return "itau";
  if (b.includes("bci")) return "bci";
  if (b.includes("estado")) return "bancoestado";
  if (b.includes("scotia")) return "scotiabank";
  if (b.includes("falabella")) return "falabella";
  return b.replace(/\s+/g, "").slice(0, 14) || "banco";
}

export type CardPayment = { date: string; amount: number; name: string };
export type CardDebt = {
  cardKey: string;
  cardLabel: string;
  bank: string;
  last4: string;
  statementMonthKey: string;
  periodEnd: string;
  pagarHasta: string;
  montoFacturado: number;
  pagado: number;
  pendienteReal: number;
  montoMinimo: number | null;
  cupoUtilizado: number | null;
  cupoTotal: number | null;
  deudaInternacionalUsd: number | null;
  pagos: CardPayment[];
  matchStatus: "linked" | "missing" | "ambiguous";
  vencido: boolean; // pagarHasta ya pasó (asOf)
  history: { statementMonthKey: string; montoFacturado: number }[];
};

/** Resuelve la cuenta de tarjeta para un estado: por last4; si hay varias, desempata por banco. */
function resolveCardAccount(statement: CreditCardStatement, accounts: Account[]) {
  const byLast4 = accounts.filter(
    (a) => a.type === "credit_card" && digits(a.accountNumber).slice(-4) === statement.last4 && statement.last4.length === 4,
  );
  if (byLast4.length <= 1) return byLast4;
  const sb = bankCode(statement.bank);
  const byBank = byLast4.filter((a) => bankCode(a.bank) === sb);
  return byBank.length ? byBank : byLast4;
}

export function buildCardDebt(
  statements: CreditCardStatement[],
  transactions: Transaction[],
  accounts: Account[],
  opts: { asOf: string },
): CardDebt[] {
  const asOf = opts.asOf;
  // Agrupa por last4 (identidad estable del plástico): el banco Y el titular se imprimen
  // distinto entre cartolas, así que partirían la misma tarjeta en dos y netearían doble.
  const byCard = new Map<string, CreditCardStatement[]>();
  for (const s of statements) {
    const key = s.last4;
    const arr = byCard.get(key) ?? [];
    arr.push(s);
    byCard.set(key, arr);
  }

  const out: CardDebt[] = [];
  for (const [cardKey, list] of Array.from(byCard.entries())) {
    const sorted = [...list].sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));
    const latest = sorted[sorted.length - 1];
    const montoFacturado = Number(latest.montoFacturado) || 0;

    const candidates = resolveCardAccount(latest, accounts);
    let matchStatus: CardDebt["matchStatus"] = "missing";
    let pagos: CardPayment[] = [];
    if (candidates.length === 1) {
      matchStatus = "linked";
      const cardName = norm(candidates[0].name);
      pagos = transactions
        .filter((t) => {
          const n = normalizeTransaction(t);
          return (
            n.movementType === "credit_card_payment" &&
            norm(t.creditCardName) === cardName &&
            isExecutedTransaction(t) &&
            String(t.date) > String(latest.periodEnd) &&
            String(t.date) <= asOf
          );
        })
        .map((t) => ({ date: t.date, amount: Number(t.amount) || 0, name: t.name }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } else if (candidates.length > 1) {
      matchStatus = "ambiguous";
    }

    const pagado = pagos.reduce((s, p) => s + p.amount, 0);
    const pendienteReal = matchStatus === "linked" ? Math.max(0, montoFacturado - pagado) : montoFacturado;

    out.push({
      cardKey,
      cardLabel: latest.cardLabel,
      bank: latest.bank,
      last4: latest.last4,
      statementMonthKey: latest.statementMonthKey,
      periodEnd: latest.periodEnd,
      pagarHasta: latest.pagarHasta,
      montoFacturado,
      pagado,
      pendienteReal,
      montoMinimo: latest.montoMinimo ?? null,
      cupoUtilizado: latest.cupoUtilizado ?? null,
      cupoTotal: latest.cupoTotal ?? null,
      deudaInternacionalUsd: latest.deudaInternacionalUsd ?? null,
      pagos,
      matchStatus,
      vencido: Boolean(latest.pagarHasta) && String(latest.pagarHasta) < asOf,
      history: sorted.map((s) => ({ statementMonthKey: s.statementMonthKey, montoFacturado: Number(s.montoFacturado) || 0 })),
    });
  }

  return out.sort((a, b) => String(a.pagarHasta).localeCompare(String(b.pagarHasta)));
}
