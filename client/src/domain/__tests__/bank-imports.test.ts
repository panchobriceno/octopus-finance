import { describe, expect, it } from "vitest";
import {
  applyBestMovementRule,
  findBestMovementRule,
  buildImportedMovement,
  buildTransactionFromImportedMovement,
  findMatchingTransactionForPayload,
  getImportBatchLifecycleStatus,
  summarizeImportBatchLifecycle,
} from "../bank-imports";
import type { MovementRule } from "@shared/schema";

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
      { ...baseMovement, id: "reconciled", status: "reconciled" },
      { ...baseMovement, id: "discarded", status: "discarded" },
    ]))).toBe("completed");
    expect(getImportBatchLifecycleStatus(summarizeImportBatchLifecycle([
      { ...baseMovement, id: "converted", status: "converted" },
    ]), "closed")).toBe("closed");
  });
});

describe("applyBestMovementRule + subcategoría (item)", () => {
  const mkRule = (p: Partial<MovementRule>): MovementRule => ({
    id: "r", name: "r", keywords: ["copec"], category: "Auto", itemId: null,
    workspace: "family", movementType: "expense", paymentMethod: "bank_account",
    accountId: null, creditCardName: null, cardAccountId: null, amountDirection: "any",
    priority: 0, isActive: true, notes: null, createdAt: "", updatedAt: "", ...p,
  });
  const mkMov = (itemId: string | null, category = "Auto") => ({
    id: "m",
    ...buildImportedMovement({
      batchId: "b", source: "manual_file", sourceName: "s", sourceType: "bank_account",
      accountId: "a", date: "2026-06-23", description: "Compra COPEC bencina", amount: 30000,
      direction: "expense", category, workspace: "family", movementType: "expense",
      paymentMethod: "bank_account", itemId, createdAt: "2026-06-23T00:00:00.000Z",
    }),
  });

  it("una regla con itemId setea la subcategoría", () => {
    const out = applyBestMovementRule(mkMov(null), [mkRule({ category: "Auto", itemId: "item-bencina" })]);
    expect(out.suggestedCategory).toBe("Auto");
    expect(out.suggestedItemId).toBe("item-bencina");
  });

  it("si la regla cambia la categoría y no trae item, limpia la subcategoría previa", () => {
    const out = applyBestMovementRule(mkMov("item-viejo", "Auto"), [mkRule({ category: "Comida", itemId: null })]);
    expect(out.suggestedCategory).toBe("Comida");
    expect(out.suggestedItemId).toBeNull();
  });

  it("si la regla no cambia la categoría y no trae item, conserva la subcategoría previa", () => {
    const out = applyBestMovementRule(mkMov("item-bencina", "Auto"), [mkRule({ category: "Auto", itemId: null })]);
    expect(out.suggestedItemId).toBe("item-bencina");
  });

  it("sin regla que matchee, conserva la subcategoría elegida", () => {
    const out = applyBestMovementRule(mkMov("item-bencina"), [mkRule({ keywords: ["falabella"] })]);
    expect(out.suggestedItemId).toBe("item-bencina");
  });
});

describe("findBestMovementRule + rango de monto (amountMin/amountMax)", () => {
  const rule = (p: Partial<MovementRule>): MovementRule => ({
    id: "r", name: "r", keywords: ["apple"], category: "Digital", itemId: null,
    workspace: "family", movementType: "expense", paymentMethod: "credit_card",
    accountId: null, creditCardName: null, cardAccountId: null, amountDirection: "any",
    priority: 0, isActive: true, notes: null, createdAt: "", updatedAt: "", ...p,
  });
  const mov = (amount: number) => ({
    id: "m",
    ...buildImportedMovement({
      batchId: "b", source: "manual_file", sourceName: "s", sourceType: "bank_account",
      accountId: "a", date: "2026-06-23", description: "APPLE.COM/BILL", amount,
      direction: "expense", category: "", workspace: "family", movementType: "expense",
      paymentMethod: "credit_card", createdAt: "2026-06-23T00:00:00.000Z",
    }),
  });

  it("sin bounds (legacy), matchea cualquier monto", () => {
    expect(findBestMovementRule(mov(102990), [rule({})])?.id).toBe("r");
    expect(findBestMovementRule(mov(9990), [rule({})])?.id).toBe("r");
  });

  it("amountMin excluye montos por debajo (borde inclusivo)", () => {
    const r = rule({ amountMin: 80000 });
    expect(findBestMovementRule(mov(79999), [r])).toBeNull();
    expect(findBestMovementRule(mov(80000), [r])?.id).toBe("r"); // == min pasa
    expect(findBestMovementRule(mov(102990), [r])?.id).toBe("r");
  });

  it("amountMax excluye montos por encima (borde inclusivo)", () => {
    const r = rule({ amountMax: 79999 });
    expect(findBestMovementRule(mov(80000), [r])).toBeNull();
    expect(findBestMovementRule(mov(79999), [r])?.id).toBe("r"); // == max pasa
    expect(findBestMovementRule(mov(19990), [r])?.id).toBe("r");
  });

  it("caso ChatGPT: dos reglas apple mutuamente excluyentes por monto", () => {
    const digital = rule({ id: "digital", category: "Digital", amountMax: 79999, priority: 5 });
    const chatgpt = rule({ id: "chatgpt", category: "Software Empresa", itemId: "item-gpt", workspace: "business", amountMin: 80000, priority: 10 });
    const rules = [digital, chatgpt];
    expect(findBestMovementRule(mov(19990), rules)?.id).toBe("digital");
    expect(findBestMovementRule(mov(102990), rules)?.id).toBe("chatgpt");
  });
});
