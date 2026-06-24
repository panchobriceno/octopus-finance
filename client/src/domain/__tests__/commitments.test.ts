import { describe, expect, it } from "vitest";
import type { CommitmentInstance } from "@shared/schema";
import { buildTransactionFromCommitmentPayment } from "../commitments";

function commitment(overrides: Partial<CommitmentInstance> = {}): CommitmentInstance {
  return {
    id: "commitment-1",
    templateId: "template-1",
    monthKey: "2026-06",
    name: "Seguro auto",
    category: "Auto",
    expectedAmount: 45990,
    amountMode: "fixed",
    dueDate: "2026-06-10",
    workspace: "family",
    movementType: "expense",
    paymentMethod: "bank_account",
    accountId: "account-santander",
    destinationAccountId: null,
    creditCardName: null,
    status: "pending",
    matchedTransactionId: null,
    matchedAt: null,
    paidAt: null,
    notes: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("commitments domain", () => {
  it("builds an executed transaction from a paid commitment", () => {
    const tx = buildTransactionFromCommitmentPayment(commitment(), {
      date: "2026-06-09",
      amount: 45990,
      paymentMethod: "credit_card",
      accountId: null,
      creditCardName: "Santander World",
      installmentCount: 3,
      notes: "Voucher 123",
    });

    expect(tx).toMatchObject({
      name: "Seguro auto",
      category: "Auto",
      amount: 45990,
      type: "expense",
      date: "2026-06-09",
      subtype: "actual",
      status: "paid",
      workspace: "family",
      movementType: "expense",
      paymentMethod: "credit_card",
      accountId: null,
      creditCardName: "Santander World",
      installmentCount: 3,
      sourceCommitmentInstanceId: "commitment-1",
      sourceCommitmentTemplateId: "template-1",
    });
    expect(tx.notes).toContain("Registrado desde compromiso mensual: Seguro auto.");
    expect(tx.notes).toContain("Voucher 123");
  });

  it("keeps credit-card payment semantics when paying the card bill", () => {
    const tx = buildTransactionFromCommitmentPayment(
      commitment({
        id: "card-payment-1",
        name: "Pago Visa Santander",
        category: "Pago tarjeta",
        movementType: "credit_card_payment",
        paymentMethod: "bank_account",
        accountId: "checking-1",
        creditCardName: "Visa Santander",
      }),
      {
        date: "2026-06-20",
        amount: 320000,
        paymentMethod: "bank_account",
        accountId: "checking-1",
        creditCardName: "Visa Santander",
        installmentCount: null,
      },
    );

    expect(tx.movementType).toBe("credit_card_payment");
    expect(tx.paymentMethod).toBe("bank_account");
    expect(tx.accountId).toBe("checking-1");
    expect(tx.creditCardName).toBe("Visa Santander");
    expect(tx.installmentCount).toBeNull();
    expect(tx.sourceCommitmentInstanceId).toBe("card-payment-1");
  });
});
