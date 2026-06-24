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
): CcMovementType {
  const normalized = normalizeText(name);
  if (TC_PAYMENT_KEYWORDS.some((kw) => normalized.includes(normalizeText(kw)))) {
    return "tc_payment";
  }
  if (rawAmount > 0) {
    const rowDate = new Date(date);
    if (!Number.isNaN(rowDate.getTime())) {
      const hasMatchingNegative = allRawRows.some((other) => {
        if (Math.abs(other.rawAmount + rawAmount) > 0.01) return false;
        const otherDate = new Date(other.date);
        if (Number.isNaN(otherDate.getTime())) return false;
        const daysDiff = Math.abs((rowDate.getTime() - otherDate.getTime()) / (1000 * 60 * 60 * 24));
        return daysDiff <= 7;
      });
      if (hasMatchingNegative) return "reversal";
    }
  }
  return "purchase";
}

export function getCreditPreviewType(ccMovementType?: CcMovementType): "expense" | "credit_card_payment" {
  return ccMovementType === "tc_payment" ? "credit_card_payment" : "expense";
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
