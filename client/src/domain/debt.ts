/**
 * Centro de Deuda: por cada tarjeta toma el ÚLTIMO estado de cuenta y le NETEA los pagos
 * EJECUTADOS hechos después del cierre, para mostrar la deuda REAL (no la del papel).
 * Helper puro: `asOf` se inyecta (no usa new Date()). Revisado por Codex.
 */
import { isExecutedTransaction, normalizeTransaction } from "@/lib/finance";
import type { CreditCardStatement, Transaction, Account } from "@shared/schema";

/** Tipo de cambio referencial USD→CLP. Fuente única: la usan Centro de Deuda, Panel de Tarjetas
 * y Resumen para convertir la deuda en dólares. Si se cambia acá, cambia en las 3 superficies a la vez. */
export const USD_CLP = 960;

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Código canónico de banco: el banco imprime su nombre distinto entre cartolas
 * (ej. "Banco Edwards" y "Banco de Chile" son el mismo). Agrupa por código + last4. */
export function bankCode(bank: unknown): string {
  const b = norm(bank);
  if (b.includes("santander")) return "santander";
  if (b.includes("itau")) return "itau";
  if (b.includes("scotia")) return "scotiabank";
  if (b.includes("falabella")) return "falabella";
  if (b.includes("bci")) return "bci";
  if (b.includes("estado")) return "bancoestado";
  if (b.includes("edward") || b.includes("chile")) return "bancochile";
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
  // Clave canónica: bankCode + last4, tomando el banco de la CUENTA-tarjeta (no de la cartola, que
  // imprime el banco/titular distinto entre períodos → partiría la misma tarjeta y netearía doble).
  // El bankCode desambigua el caso (raro) de dos tarjetas de bancos distintos con el mismo last4.
  const cardByLast4 = new Map<string, Account>();
  const accById = new Map(accounts.map((a) => [a.id, a]));
  for (const a of accounts) {
    if (a.type !== "credit_card") continue;
    const l4 = digits(a.accountNumber).slice(-4);
    if (l4.length === 4) cardByLast4.set(l4, a);
  }
  const byCard = new Map<string, CreditCardStatement[]>();
  for (const s of statements) {
    const acc = cardByLast4.get(s.last4);
    const key = `${bankCode(acc?.bank ?? s.bank)}:${s.last4}`;
    const arr = byCard.get(key) ?? [];
    arr.push(s);
    byCard.set(key, arr);
  }

  const out: CardDebt[] = [];
  for (const [cardKey, list] of Array.from(byCard.entries())) {
    const sorted = [...list].sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));
    const latest = sorted[sorted.length - 1];
    const montoFacturado = Number(latest.montoFacturado) || 0;

    // Netea pagos de tarjeta ejecutados, entre el cierre y asOf, cuya tarjeta == este estado.
    // Prefiere cardAccountId (identidad estructural del relink); si no, cae al last4 del nombre.
    const pagos: CardPayment[] = transactions
      .filter((t) => {
        const n = normalizeTransaction(t);
        const payL4 = n.cardAccountId
          ? digits(accById.get(n.cardAccountId)?.accountNumber).slice(-4)
          : paymentCardLast4(t.creditCardName, accounts);
        return (
          n.movementType === "credit_card_payment" &&
          isExecutedTransaction(t) &&
          String(t.date) > String(latest.periodEnd) &&
          String(t.date) <= asOf &&
          payL4 === latest.last4
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
