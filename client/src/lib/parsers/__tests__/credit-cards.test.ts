import { describe, expect, it } from "vitest";
import { detectMovementType, isSimilarCreditCardPayment } from "../credit-cards";

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

    expect(detectMovementType("Reversa Ripley", 45000, "2026-06-12", rows)).toBe("reversal");
  });

  it("does not mark positive amounts as reversals without an opposite nearby row", () => {
    expect(detectMovementType("Abono cliente", 45000, "2026-06-10", [])).toBe("purchase");
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
