import { describe, expect, it } from "vitest";
import {
  detectMovementType,
  getCreditPreviewType,
  isImportableCreditMovementType,
  isSimilarCreditCardPayment,
} from "../credit-cards";

describe("credit-card parser helpers", () => {
  it("classifies card payments and purchases", () => {
    expect(detectMovementType("Pago pesos tef tarjeta", 50000, "2026-06-01", [])).toBe("tc_payment");
    expect(detectMovementType("Compra Lider", -12000, "2026-06-01", [])).toBe("purchase");
  });

  it("detects reversals when the opposite amount appears nearby", () => {
    const rows = [
      { name: "Compra Ripley", rawAmount: -45000, date: "2026-06-10" },
      { name: "Reversa Ripley", rawAmount: 45000, date: "2026-06-12" },
    ];

    expect(detectMovementType("Reversa Ripley", 45000, "2026-06-12", rows, 1)).toBe("reversal");
    expect(detectMovementType("Compra Ripley", -45000, "2026-06-10", rows, 0)).toBe("reversal");
  });

  it("pairs reversals one-to-one so a single credit does not erase repeated purchases", () => {
    const rows = [
      { name: "Compra Ripley 1", rawAmount: -45000, date: "2026-06-10" },
      { name: "Compra Ripley 2", rawAmount: -45000, date: "2026-06-11" },
      { name: "Reversa Ripley", rawAmount: 45000, date: "2026-06-12" },
    ];

    expect(detectMovementType("Compra Ripley 1", -45000, "2026-06-10", rows, 0)).toBe("purchase");
    expect(detectMovementType("Compra Ripley 2", -45000, "2026-06-11", rows, 1)).toBe("reversal");
    expect(detectMovementType("Reversa Ripley", 45000, "2026-06-12", rows, 2)).toBe("reversal");
  });

  it("does not use card payment rows as reversal counterparts", () => {
    const rows = [
      { name: "Compra supermercado", rawAmount: -50000, date: "2026-06-10" },
      { name: "Pago pesos tef tarjeta", rawAmount: 50000, date: "2026-06-11" },
    ];

    expect(detectMovementType("Compra supermercado", -50000, "2026-06-10", rows, 0)).toBe("purchase");
    expect(detectMovementType("Pago pesos tef tarjeta", 50000, "2026-06-11", rows, 1)).toBe("tc_payment");
  });

  it("marks unmatched positive card credits for review instead of treating them as purchases", () => {
    expect(detectMovementType("Abono cliente", 45000, "2026-06-10", [])).toBe("credit_review");
  });

  it("keeps card payment keywords ahead of positive-credit review", () => {
    expect(detectMovementType("Pago pesos tef tarjeta", 50000, "2026-06-01", [])).toBe("tc_payment");
  });

  it("keeps review-only credit states out of the import queue", () => {
    expect(getCreditPreviewType("credit_review")).toBe("expense");
    expect(isImportableCreditMovementType("purchase")).toBe(true);
    expect(isImportableCreditMovementType("tc_payment")).toBe(true);
    expect(isImportableCreditMovementType("reversal")).toBe(false);
    expect(isImportableCreditMovementType("credit_review")).toBe(false);
  });

  it("matches similar credit-card payments by card, amount and nearby date", () => {
    const payment = {
      id: "tx-1",
      type: "expense",
      movementType: "credit_card_payment",
      status: "paid",
      creditCardName: "Santander World",
      amount: 150000,
      date: "2026-06-20",
      accountId: "account-1",
    };

    expect(isSimilarCreditCardPayment(payment, "santander world", 150000, "2026-06-22")).toBe(true);
    expect(isSimilarCreditCardPayment(payment, "santander world", 150000, "2026-06-27")).toBe(false);
    expect(isSimilarCreditCardPayment(payment, "Itau", 150000, "2026-06-22")).toBe(false);
  });
});
