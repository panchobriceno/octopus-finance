import { describe, it, expect } from "vitest";
import { buildSpendingAnalysis, addMonthKey } from "../spending";
import type { Transaction } from "@shared/schema";

function tx(p: Partial<Transaction> = {}): Transaction {
  return {
    id: "t", name: "Gasto", category: "Comida", amount: 10000, type: "expense", date: "2026-06-10",
    notes: null, subtype: "actual", status: "paid", itemId: null, workspace: "family",
    movementType: "expense", paymentMethod: "bank_account", destinationWorkspace: null,
    destinationAccountId: null, creditCardName: null, installmentCount: null, accountId: null,
    sourceClientPaymentId: null, importBatchId: null, importBatchLabel: null, importedAt: null, ...p,
  } as Transaction;
}

describe("buildSpendingAnalysis", () => {
  it("agrupa por categoría y suma el mes", () => {
    const r = buildSpendingAnalysis(
      [tx({ category: "Comida", amount: 10000 }), tx({ category: "Comida", amount: 5000 }), tx({ category: "Digital", amount: 3000 })],
      { monthKey: "2026-06" },
    );
    expect(r.totalMes).toBe(18000);
    expect(r.byCategory[0]).toEqual({ categoria: "Comida", monto: 15000 });
  });

  it("excluye transfer, credit_card_payment, income, planned y cancelled", () => {
    const r = buildSpendingAnalysis(
      [
        tx({ amount: 10000 }),
        tx({ movementType: "transfer", type: "expense", amount: 99999 }),
        tx({ movementType: "credit_card_payment", amount: 88888 }),
        tx({ movementType: "income", type: "income", amount: 77777 }),
        tx({ subtype: "planned", amount: 66666 }),
        tx({ status: "cancelled", amount: 55555 }),
      ],
      { monthKey: "2026-06" },
    );
    expect(r.totalMes).toBe(10000);
  });

  it("trend devuelve monthsBack meses, en orden", () => {
    const r = buildSpendingAnalysis(
      [tx({ date: "2026-06-10", amount: 10000 }), tx({ date: "2026-05-10", amount: 5000 })],
      { monthKey: "2026-06", monthsBack: 3 },
    );
    expect(r.trend.length).toBe(3);
    expect(r.trend[r.trend.length - 1]).toEqual({ monthKey: "2026-06", monto: 10000 });
    expect(r.trend.find((x) => x.monthKey === "2026-05")?.monto).toBe(5000);
  });

  it("addMonthKey cruza el año", () => {
    expect(addMonthKey("2026-01", -1)).toBe("2025-12");
    expect(addMonthKey("2026-12", 1)).toBe("2027-01");
  });
});
