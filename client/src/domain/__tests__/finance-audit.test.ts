import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Category,
  ImportBatch,
  ImportedMovement,
  Item,
  MovementRule,
} from "@shared/schema";
import { auditFinanceData, type FinanceAuditInput } from "../finance-audit";

const baseInput = (overrides: Partial<FinanceAuditInput> = {}): FinanceAuditInput => ({
  transactions: [],
  categories: [],
  items: [],
  budgets: [],
  clientPayments: [],
  clients: [],
  accounts: [],
  creditCardSettings: [],
  openingBalances: [],
  ...overrides,
});

const category = (overrides: Partial<Category> = {}): Category => ({
  id: "cat-food",
  name: "Comida",
  type: "expense",
  color: null,
  workspace: "family",
  ...overrides,
});

const item = (overrides: Partial<Item> = {}): Item => ({
  id: "item-food",
  name: "Super",
  categoryId: "cat-food",
  ...overrides,
});

const importedMovement = (overrides: Partial<ImportedMovement> = {}): ImportedMovement => ({
  id: "movement-1",
  batchId: "batch-1",
  externalId: null,
  dedupeKey: "movement-1",
  source: "manual_file",
  sourceName: "cartola.csv",
  sourceType: "bank_account",
  bankName: "Banco",
  accountId: "account-1",
  creditCardName: null,
  date: "2026-07-01",
  description: "Supermercado",
  rawDescription: "Supermercado",
  amount: 1000,
  direction: "expense",
  currency: "CLP",
  suggestedName: "Supermercado",
  suggestedCategory: "Comida",
  suggestedWorkspace: "family",
  suggestedMovementType: "expense",
  suggestedPaymentMethod: "bank_account",
  suggestedDestinationWorkspace: null,
  suggestedDestinationAccountId: null,
  suggestedSourceAccountId: null,
  installmentCount: null,
  confidence: 0.9,
  matchedRuleId: null,
  duplicateTransactionId: null,
  duplicateMovementId: null,
  status: "pending",
  matchedTransactionId: null,
  notes: null,
  isDemo: false,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  convertedAt: null,
  discardedAt: null,
  ...overrides,
});

const importBatch = (overrides: Partial<ImportBatch> = {}): ImportBatch => ({
  id: "batch-1",
  label: "Cartola julio",
  source: "manual_file",
  sourceName: "cartola.csv",
  sourceType: "bank_account",
  bankName: "Banco",
  accountId: "account-1",
  creditCardName: null,
  workspace: "family",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  rowCount: 1,
  totalIncome: 0,
  totalExpense: 1000,
  duplicateCount: 0,
  status: "reviewing",
  isDemo: false,
  notes: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

const movementRule = (overrides: Partial<MovementRule> = {}): MovementRule => ({
  id: "rule-1",
  name: "Supermercado",
  keywords: ["super"],
  category: "Comida",
  itemId: "item-food",
  workspace: "family",
  movementType: "expense",
  paymentMethod: "bank_account",
  accountId: null,
  creditCardName: null,
  amountDirection: "any",
  priority: 1,
  isActive: true,
  notes: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auditFinanceData import pipeline checks", () => {
  it("flags resolved imported movements without a valid matched transaction", () => {
    const audit = auditFinanceData(
      baseInput({
        importedMovements: [
          importedMovement({
            status: "converted",
            matchedTransactionId: "missing-tx",
            convertedAt: "2026-07-01T12:00:00.000Z",
          }),
        ],
      }),
    );

    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "high",
          area: "import-pipeline",
          title: "Cartola resuelta apunta a transaccion inexistente",
          recordId: "movement-1",
        }),
      ]),
    );
  });

  it("flags stale import batches still under review", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:00:00.000Z"));

    const audit = auditFinanceData(
      baseInput({
        importBatches: [
          importBatch({
            status: "partially_converted",
            createdAt: "2026-06-01T00:00:00.000Z",
          }),
        ],
      }),
    );

    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "medium",
          area: "import-pipeline",
          title: "Lote de importacion viejo en revision",
          recordId: "batch-1",
        }),
      ]),
    );
  });

  it("validates movement rule category and item with the canonical resolver", () => {
    const audit = auditFinanceData(
      baseInput({
        categories: [category(), category({ id: "cat-other", name: "Servicios", workspace: "family" })],
        items: [item(), item({ id: "item-other", categoryId: "cat-other" })],
        movementRules: [
          movementRule({ id: "rule-ok", itemId: "item-food" }),
          movementRule({ id: "rule-bad-item", itemId: "item-other" }),
          movementRule({ id: "rule-bad-category", category: "No existe", itemId: null }),
        ],
      }),
    );

    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Regla apunta a subcategoria incompatible",
          recordId: "rule-bad-item",
        }),
        expect.objectContaining({
          title: "Regla apunta a categoria inexistente",
          recordId: "rule-bad-category",
        }),
      ]),
    );
    expect(audit.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordId: "rule-ok" }),
      ]),
    );
  });
});
