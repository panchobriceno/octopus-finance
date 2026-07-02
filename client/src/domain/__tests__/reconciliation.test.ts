import { describe, expect, it } from "vitest";
import type { Account, ImportBatch, ImportedMovement, Transaction } from "@shared/schema";
import {
  buildAccountReconciliationWorkspace,
  findAccountsMissingMonthlyStatements,
  getImportedMovementImpact,
  getTransactionAccountImpact,
  scoreReconciliationCandidate,
} from "../reconciliation";

const account: Account = {
  id: "santander-family",
  name: "Cuenta Santander Familia",
  bank: "Santander",
  type: "checking",
  currentBalance: 500000,
  currency: "CLP",
  workspace: "family",
  isShared: false,
  notes: null,
  updatedAt: "2026-06-24T00:00:00.000Z",
};

const batch: ImportBatch = {
  id: "batch-1",
  label: "Cartola Santander junio",
  source: "manual_file",
  sourceName: "Santander",
  sourceType: "bank_account",
  bankName: "Santander",
  accountId: account.id,
  creditCardName: null,
  workspace: "family",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  rowCount: 2,
  totalIncome: 0,
  totalExpense: 0,
  duplicateCount: 0,
  status: "reviewing",
  isDemo: false,
  notes: null,
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z",
};

function movement(overrides: Partial<ImportedMovement> = {}): ImportedMovement {
  return {
    id: "movement-1",
    batchId: batch.id,
    externalId: null,
    dedupeKey: "movement-1",
    source: "manual_file",
    sourceName: "Santander",
    sourceType: "bank_account",
    bankName: "Santander",
    accountId: account.id,
    creditCardName: null,
    date: "2026-06-10",
    description: "Uber Eats",
    rawDescription: "Uber Eats",
    amount: 12990,
    direction: "expense",
    currency: "CLP",
    suggestedName: "Uber Eats",
    suggestedCategory: "Comida",
    suggestedWorkspace: "family",
    suggestedMovementType: "expense",
    suggestedPaymentMethod: "bank_account",
    suggestedDestinationWorkspace: null,
    suggestedDestinationAccountId: null,
    installmentCount: null,
    confidence: 90,
    matchedRuleId: null,
    duplicateTransactionId: null,
    duplicateMovementId: null,
    status: "pending",
    matchedTransactionId: null,
    notes: null,
    isDemo: false,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    convertedAt: null,
    discardedAt: null,
    ...overrides,
  };
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "transaction-1",
    name: "Uber Eats",
    category: "Comida",
    amount: 12990,
    type: "expense",
    date: "2026-06-10",
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
    accountId: account.id,
    sourceClientPaymentId: null,
    importBatchId: null,
    importBatchLabel: null,
    importedAt: null,
    ...overrides,
  };
}

describe("reconciliation domain", () => {
  it("scores exact same-account matches as confident candidates", () => {
    const candidate = scoreReconciliationCandidate(movement(), transaction(), account);

    expect(candidate?.score).toBeGreaterThanOrEqual(84);
    expect(candidate?.reasons).toContain("monto exacto");
    expect(candidate?.reasons).toContain("misma fecha");
  });

  it("derives row states and monthly differences for an account", () => {
    const importedMovements = [
      movement({ id: "matched", description: "Uber Eats" }),
      movement({ id: "missing", description: "Apple One", amount: 5990, date: "2026-06-12" }),
      movement({ id: "discarded", status: "discarded", amount: 1000 }),
    ];
    const transactions = [
      transaction({ id: "tx-uber", name: "Uber Eats" }),
      transaction({ id: "tx-rent", name: "Arriendo", amount: 300000, date: "2026-06-05" }),
    ];

    const workspace = buildAccountReconciliationWorkspace({
      account,
      monthKey: "2026-06",
      transactions,
      importedMovements,
      importBatches: [batch],
    });

    expect(workspace.importedExpense).toBe(18980);
    expect(workspace.registeredExpense).toBe(312990);
    expect(workspace.difference).toBe(294010);
    expect(workspace.rows.find((row) => row.id === "matched")?.status).toBe("confident_match");
    expect(workspace.rows.find((row) => row.id === "missing")?.status).toBe("missing_transaction");
    expect(workspace.rows.find((row) => row.id === "discarded")?.status).toBe("discarded");
    expect(workspace.unmatchedRegisteredTransactions.map((tx) => tx.id)).toEqual(["tx-rent"]);
  });

  it("calculates account impacts with bank and credit-card semantics", () => {
    const creditCard: Account = {
      ...account,
      id: "card-1",
      name: "Santander World",
      type: "credit_card",
      currentBalance: -100000,
    };

    expect(getImportedMovementImpact(movement({ direction: "income", amount: 5000 }))).toBe(5000);
    expect(getImportedMovementImpact(movement({ direction: "expense", amount: 5000 }))).toBe(-5000);
    expect(getTransactionAccountImpact(transaction({ movementType: "income", type: "income", amount: 7000 }), account)).toBe(7000);
    expect(getTransactionAccountImpact(transaction({ amount: 7000 }), account)).toBe(-7000);
    expect(getTransactionAccountImpact(transaction({
      id: "card-expense",
      paymentMethod: "credit_card",
      creditCardName: "Santander World",
      accountId: null,
      amount: 9000,
    }), creditCard)).toBe(-9000);
    expect(getTransactionAccountImpact(transaction({
      id: "card-payment",
      movementType: "credit_card_payment",
      paymentMethod: "bank_account",
      creditCardName: "Santander World",
      accountId: account.id,
      amount: 9000,
    }), creditCard)).toBe(9000);
  });

  it("flags active accounts and cards without imported movements in the month", () => {
    const creditCard: Account = {
      ...account,
      id: "card-1",
      name: "Santander World 1234",
      type: "credit_card",
      currentBalance: -100000,
    };
    const savings: Account = {
      ...account,
      id: "savings-1",
      name: "Ahorro Santander",
      type: "savings",
    };
    const inactiveChecking: Account = {
      ...account,
      id: "inactive-1",
      name: "Cuenta antigua",
      isActive: false,
    } as Account;
    const creditLine: Account = {
      ...account,
      id: "credit-line-1",
      name: "Línea de crédito",
      type: "credit_line",
    };

    const missing = findAccountsMissingMonthlyStatements({
      accounts: [account, creditCard, savings, inactiveChecking, creditLine],
      monthKey: "2026-06",
      importedMovements: [
        movement({ id: "bank-row", accountId: account.id, date: "2026-06-04" }),
        movement({
          id: "card-row",
          accountId: null,
          cardAccountId: creditCard.id,
          creditCardName: "Santander World 1234",
          sourceType: "credit_card",
          date: "2026-06-08",
        }),
        movement({ id: "old-savings-row", accountId: savings.id, date: "2026-05-31" }),
        movement({ id: "next-month-savings-row", accountId: savings.id, date: "2026-07-01" }),
      ],
    });

    expect(missing.map((entry) => entry.account.id)).toEqual(["savings-1"]);

    const allMissing = findAccountsMissingMonthlyStatements({
      accounts: [account, creditCard, savings, inactiveChecking, creditLine],
      monthKey: "2026-06",
      importedMovements: [],
    });

    expect(allMissing.map((entry) => entry.account.id)).toEqual(["santander-family", "card-1", "savings-1"]);
  });
});
