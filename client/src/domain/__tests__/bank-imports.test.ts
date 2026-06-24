import { describe, expect, it } from "vitest";
import {
  buildImportedMovement,
  buildTransactionFromImportedMovement,
  findMatchingTransactionForPayload,
  getImportBatchLifecycleStatus,
  summarizeImportBatchLifecycle,
} from "../bank-imports";

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

  it("finds an existing transaction that matches the imported movement payload", () => {
    const movement = {
      id: "movement-1",
      ...buildImportedMovement({
        batchId: "batch-1",
        source: "manual_file",
        sourceName: "Cartola banco",
        sourceType: "bank_account",
        accountId: "account-1",
        date: "2026-06-23",
        description: "Pago proveedor ACME",
        amount: 120000,
        direction: "expense",
        category: "Proveedores",
        workspace: "business",
        movementType: "expense",
        paymentMethod: "bank_account",
        createdAt: "2026-06-23T12:00:00.000Z",
      }),
    };
    const payload = buildTransactionFromImportedMovement(movement);

    const match = findMatchingTransactionForPayload(payload, [
      {
        id: "transaction-1",
        ...payload,
        name: "  pago   proveedor acme ",
      },
    ]);

    expect(match?.id).toBe("transaction-1");
  });

  it("ignores cancelled transactions when matching imported movements", () => {
    const movement = {
      id: "movement-1",
      ...buildImportedMovement({
        batchId: "batch-1",
        source: "manual_file",
        sourceName: "Cartola banco",
        sourceType: "bank_account",
        accountId: "account-1",
        date: "2026-06-23",
        description: "Pago duplicado",
        amount: 45000,
        direction: "expense",
        category: "Otros",
        workspace: "family",
        movementType: "expense",
        paymentMethod: "bank_account",
        createdAt: "2026-06-23T12:00:00.000Z",
      }),
    };
    const payload = buildTransactionFromImportedMovement(movement);

    const match = findMatchingTransactionForPayload(payload, [
      {
        id: "transaction-cancelled",
        ...payload,
        status: "cancelled",
      },
    ]);

    expect(match).toBeNull();
  });

  it("derives lifecycle status for import batches", () => {
    const baseMovement = {
      id: "movement-1",
      ...buildImportedMovement({
        batchId: "batch-1",
        source: "manual_file",
        sourceName: "Cartola banco",
        sourceType: "bank_account",
        accountId: "account-1",
        date: "2026-06-23",
        description: "Movimiento",
        amount: 1000,
        direction: "expense",
        category: "Otros",
        workspace: "family",
        movementType: "expense",
        paymentMethod: "bank_account",
        createdAt: "2026-06-23T12:00:00.000Z",
      }),
    };

    expect(getImportBatchLifecycleStatus(summarizeImportBatchLifecycle([
      { ...baseMovement, id: "pending", status: "pending" },
    ]))).toBe("reviewing");
    expect(getImportBatchLifecycleStatus(summarizeImportBatchLifecycle([
      { ...baseMovement, id: "converted", status: "converted" },
      { ...baseMovement, id: "pending", status: "pending" },
    ]))).toBe("partially_converted");
    expect(getImportBatchLifecycleStatus(summarizeImportBatchLifecycle([
      { ...baseMovement, id: "converted", status: "converted" },
      { ...baseMovement, id: "discarded", status: "discarded" },
    ]))).toBe("completed");
    expect(getImportBatchLifecycleStatus(summarizeImportBatchLifecycle([
      { ...baseMovement, id: "converted", status: "converted" },
    ]), "closed")).toBe("closed");
  });
});
