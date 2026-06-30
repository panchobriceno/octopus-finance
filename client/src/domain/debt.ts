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
  vencido: boolean; // pagarHasta ya pasó (asOf)
  history: { statementMonthKey: string; montoFacturado: number }[];
};

/** Últimos 4 dígitos de la tarjeta que pagó una transacción.
 * 1) si creditCardName TERMINA en 4 dígitos (ej "Banco … …1449") → esos (estricto: solo al final,
 *    para no agarrar un "2024" interno); 2) si no, cuenta credit_card por nombre exacto → su last4. */
export function paymentCardLast4(creditCardName: unknown, accounts: Account[]): string | null {
  const cc = String(creditCardName ?? "").trim();
  if (!cc) return null;
  const m = cc.match(/(\d{4})\s*$/);
  if (m) return m[1];
  const acc = accounts.find((a) => a.type === "credit_card" && norm(a.name) === norm(cc));
  if (acc) {
    const l4 = digits(acc.accountNumber).slice(-4);
    if (l4.length === 4) return l4;
  }
  return null;
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

    // Netea por LAST4: pagos de tarjeta ejecutados, entre el cierre y asOf, cuya tarjeta == este estado.
    const pagos: CardPayment[] = transactions
      .filter((t) => {
        const n = normalizeTransaction(t);
        return (
          n.movementType === "credit_card_payment" &&
          isExecutedTransaction(t) &&
          String(t.date) > String(latest.periodEnd) &&
          String(t.date) <= asOf &&
          paymentCardLast4(t.creditCardName, accounts) === latest.last4
        );
      })
      .map((t) => ({ date: t.date, amount: Number(t.amount) || 0, name: t.name }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const pagado = pagos.reduce((s, p) => s + p.amount, 0);
    const pendienteReal = Math.max(0, montoFacturado - pagado);

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
      vencido: Boolean(latest.pagarHasta) && String(latest.pagarHasta) < asOf,
      history: sorted.map((s) => ({ statementMonthKey: s.statementMonthKey, montoFacturado: Number(s.montoFacturado) || 0 })),
    });
  }

  return out.sort((a, b) => String(a.pagarHasta).localeCompare(String(b.pagarHasta)));
}
