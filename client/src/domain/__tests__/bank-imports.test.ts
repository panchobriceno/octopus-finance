import { describe, expect, it } from "vitest";
import { buildImportedMovement, buildTransactionFromImportedMovement } from "../bank-imports";

describe("bank import domain", () => {
  it("preserves installment count from imported movement to transaction", () => {
    const movement = {
      id: "movement-1",
      ...buildImportedMovement({
        batchId: "batch-1",
        source: "manual_file",
        sourceName: "Cartola tarjeta",
        sourceType: "credit_card",
        creditCardName: "Santander World",
        date: "2026-06-23",
        description: "Compra retail",
        amount: 89990,
        direction: "expense",
        category: "Otros",
        workspace: "family",
        movementType: "expense",
        paymentMethod: "credit_card",
        installmentCount: 12,
        createdAt: "2026-06-23T12:00:00.000Z",
      }),
    };

    expect(movement.installmentCount).toBe(12);
    expect(buildTransactionFromImportedMovement(movement).installmentCount).toBe(12);
  });
});
