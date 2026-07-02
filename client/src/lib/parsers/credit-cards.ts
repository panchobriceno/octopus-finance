import type { BankParser, CcMovementType, CreditCardPaymentTransaction } from "./types";
import { inferMapping, isLikelyCreditCardImport, normalizeText } from "./csv-core";
import { TC_PAYMENT_KEYWORDS } from "./suggestions";

export const creditCardParser: BankParser = {
  id: "credit-card",
  label: "Tarjeta de credito",
  sourceName: "Cartola tarjeta de credito",
  bankName: null,
  canHandle: (input) =>
    input.accountType === "credit" ||
    (input.sourceKind !== "pdf" && isLikelyCreditCardImport(input.headers, input.lines)),
  inferMapping,
};

export function detectMovementType(
  name: string,
  rawAmount: number,
  date: string,
  allRawRows: Array<{ name: string; rawAmount: number; date: string }>,
  rowIndex?: number,
): CcMovementType {
  const normalized = normalizeText(name);
  if (TC_PAYMENT_KEYWORDS.some((kw) => normalized.includes(normalizeText(kw)))) {
    return "tc_payment";
  }
  if (rawAmount !== 0 && getReversalRowIndexes(allRawRows).has(resolveCurrentRowIndex(name, rawAmount, date, allRawRows, rowIndex))) {
    return "reversal";
  }
  if (rawAmount > 0) return "credit_review";
  return "purchase";
}

function isCreditCardPaymentName(name: string) {
  const normalized = normalizeText(name);
  return TC_PAYMENT_KEYWORDS.some((kw) => normalized.includes(normalizeText(kw)));
}

function resolveCurrentRowIndex(
  name: string,
  rawAmount: number,
  date: string,
  allRawRows: Array<{ name: string; rawAmount: number; date: string }>,
  rowIndex?: number,
) {
  if (rowIndex !== undefined) return rowIndex;
  return allRawRows.findIndex((row) =>
    row.name === name &&
    row.rawAmount === rawAmount &&
    row.date === date,
  );
}

function getReversalRowIndexes(allRawRows: Array<{ name: string; rawAmount: number; date: string }>) {
  const matched = new Set<number>();
  const usedNegatives = new Set<number>();
  const rows = allRawRows.map((row, index) => ({ ...row, index, parsedDate: new Date(row.date) }));
  const positiveCredits = rows
    .filter((row) =>
      row.rawAmount > 0 &&
      !isCreditCardPaymentName(row.name) &&
      !Number.isNaN(row.parsedDate.getTime()),
    )
    .sort((left, right) => left.parsedDate.getTime() - right.parsedDate.getTime());

  for (const credit of positiveCredits) {
    const match = rows
      .filter((candidate) => {
        if (candidate.rawAmount >= 0 || usedNegatives.has(candidate.index)) return false;
        if (Math.abs(candidate.rawAmount + credit.rawAmount) > 0.01) return false;
        if (Number.isNaN(candidate.parsedDate.getTime())) return false;
        return getDateDistanceInDays(candidate.date, credit.date) <= 7;
      })
      .sort((left, right) => {
        const leftDistance = getDateDistanceInDays(left.date, credit.date);
        const rightDistance = getDateDistanceInDays(right.date, credit.date);
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
        return left.index - right.index;
      })[0];

    if (!match) continue;
    usedNegatives.add(match.index);
    matched.add(match.index);
    matched.add(credit.index);
  }

  return matched;
}

export function getCreditPreviewType(ccMovementType?: CcMovementType): "expense" | "credit_card_payment" {
  switch (ccMovementType) {
    case "tc_payment":
      return "credit_card_payment";
    case "purchase":
    case "reversal":
    case "credit_review":
    default:
      // Reversas y abonos en revisión se excluyen de la importación; el tipo
      // expense solo permite reutilizar sugerencias/categorías del preview.
      return "expense";
  }
}

export function isImportableCreditMovementType(ccMovementType?: CcMovementType) {
  return ccMovementType !== "reversal" && ccMovementType !== "credit_review";
}

function getDateDistanceInDays(left: string, right: string) {
  const leftDate = new Date(left);
  const rightDate = new Date(right);

  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs((leftDate.getTime() - rightDate.getTime()) / (1000 * 60 * 60 * 24));
}

export function isSimilarCreditCardPayment(
  tx: CreditCardPaymentTransaction,
  cardName: string,
  amount: number,
  date: string,
) {
  if ((tx.status ?? "paid") === "cancelled") return false;

  const movementType = tx.movementType ?? (tx.type === "income" ? "income" : "expense");
  if (movementType !== "credit_card_payment") return false;

  if (normalizeText(tx.creditCardName ?? "") !== normalizeText(cardName)) return false;
  if (Math.abs((tx.amount ?? 0) - amount) > 0.01) return false;

  return getDateDistanceInDays(tx.date, date) <= 3;
}

export function findSimilarCreditCardPayment(
  transactions: CreditCardPaymentTransaction[],
  cardName: string,
  amount: number,
  date: string,
) {
  const matches = transactions
    .filter((tx) => isSimilarCreditCardPayment(tx, cardName, amount, date))
    .sort((left, right) => {
      const leftNeedsAccount = left.accountId ? 1 : 0;
      const rightNeedsAccount = right.accountId ? 1 : 0;
      if (leftNeedsAccount !== rightNeedsAccount) return leftNeedsAccount - rightNeedsAccount;

      const leftDistance = getDateDistanceInDays(left.date, date);
      const rightDistance = getDateDistanceInDays(right.date, date);
      return leftDistance - rightDistance;
    });

  return matches[0] ?? null;
}
