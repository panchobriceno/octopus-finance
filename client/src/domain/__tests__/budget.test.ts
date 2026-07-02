import { describe, expect, it } from "vitest";
import type { Transaction } from "@shared/schema";
import { isExecutedBudgetExpenseTransaction } from "../budget";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    name: "Compra",
    category: "Comida",
    amount: 10000,
    type: "expense",
    date: "2026-06-12",
    notes: null,
    subtype: "actual",
    status: "paid",
    itemId: null,
    workspace: "family",
    movementType: "expense",
    paymentMethod: "bank_account",
    destinationWorkspace: null,
    destinationAccountId: null,
    creditCardName: null,
    accountId: "account-1",
    sourceClientPaymentId: null,
    importBatchId: null,
    importBatchLabel: null,
    importedAt: null,
    ...overrides,
  };
}

describe("budget domain", () => {
  it("uses canonical executed expense semantics for budget actuals", () => {
    expect(
      isExecutedBudgetExpenseTransaction(
        transaction({ id: "bank-pending", status: "pending", paymentMethod: "bank_account" }),
        "2026-06",
        "family",
      ),
    ).toBe(false);

    expect(
      isExecutedBudgetExpenseTransaction(
        transaction({
          id: "card-pending",
          status: "pending",
          paymentMethod: "credit_card",
          cardAccountId: "card-1",
          accountId: null,
        }),
        "2026-06",
        "family",
      ),
    ).toBe(true);
  });

  it("ignores other months and workspaces", () => {
    expect(
      isExecutedBudgetExpenseTransaction(
        transaction({ id: "other-month", date: "2026-07-01" }),
        "2026-06",
        "family",
      ),
    ).toBe(false);

    expect(
      isExecutedBudgetExpenseTransaction(
        transaction({ id: "other-workspace", workspace: "business" }),
        "2026-06",
        "family",
      ),
    ).toBe(false);
  });

  it("ignores planned, cancelled, generated, and non-expense movements", () => {
    const ignoredTransactions = [
      transaction({ id: "planned", subtype: "planned", status: "pending" }),
      transaction({ id: "cancelled", status: "cancelled" }),
      transaction({ id: "generated", sourceClientPaymentId: "client-payment-1" }),
      transaction({ id: "transfer", movementType: "transfer", type: "transfer" }),
      transaction({ id: "card-payment", movementType: "credit_card_payment" }),
    ];

    expect(
      ignoredTransactions.map((tx) =>
        isExecutedBudgetExpenseTransaction(tx, "2026-06", "family"),
      ),
    ).toEqual([false, false, false, false, false]);
  });
});
