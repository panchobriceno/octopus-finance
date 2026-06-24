import { describe, expect, it } from "vitest";
import {
  buildBrokenReferencesPlan,
  buildMergeDuplicateCategoriesPlan,
  type RepairPlanData,
} from "../repair-plans";

describe("repair plan domain", () => {
  it("builds a plan to repair missing category and item references", () => {
    const input: RepairPlanData = {
      categories: [],
      items: [
        {
          id: "item-1",
          name: "Bencina",
          categoryId: "missing-category",
        } as any,
      ],
      transactions: [
        {
          id: "transaction-1",
          name: "Shell",
          type: "expense",
          status: "paid",
          workspace: "family",
          itemId: "missing-item",
          category: "item:missing-item",
        } as any,
      ],
      budgets: [
        {
          id: "budget-1",
          year: 2026,
          month: 6,
          workspace: "family",
          categoryGroup: "item:missing-budget-item",
        } as any,
      ],
    };

    const plan = buildBrokenReferencesPlan(input, {
      createId: (_collection, hint) => `created:${hint}`,
    });

    expect(plan.summary.categoriesCreated).toBe(2);
    expect(plan.summary.itemsReassigned).toBe(1);
    expect(plan.summary.transactionsUpdated).toBe(1);
    expect(plan.summary.budgetsUpdated).toBe(1);
    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: "update",
          collection: "items",
          recordId: "item-1",
          patch: expect.objectContaining({ categoryId: "created:sin categoria::expense::business" }),
        }),
        expect.objectContaining({
          op: "update",
          collection: "transactions",
          recordId: "transaction-1",
          patch: expect.objectContaining({ itemId: null, category: "Sin categoría" }),
        }),
        expect.objectContaining({
          op: "update",
          collection: "budgets",
          recordId: "budget-1",
          patch: expect.objectContaining({ categoryGroup: "Sin categoría" }),
        }),
      ]),
    );
  });

  it("builds a category merge plan across related references", () => {
    const input: RepairPlanData = {
      categories: [
        {
          id: "category-main",
          name: "Auto",
          type: "expense",
          workspace: "family",
          color: "",
        } as any,
        {
          id: "category-duplicate",
          name: "Auto",
          type: "expense",
          workspace: "family",
          color: "#111111",
        } as any,
      ],
      items: [
        {
          id: "item-main",
          name: "Bencina",
          categoryId: "category-main",
        } as any,
        {
          id: "item-duplicate",
          name: "Bencina",
          categoryId: "category-duplicate",
        } as any,
      ],
      transactions: [
        {
          id: "transaction-1",
          type: "expense",
          workspace: "family",
          itemId: "item-duplicate",
          category: "item:item-duplicate",
        } as any,
      ],
      budgets: [
        {
          id: "budget-1",
          year: 2026,
          month: 6,
          workspace: "family",
          categoryGroup: "item:item-duplicate",
          amount: 100000,
          isArchived: false,
        } as any,
      ],
      commitmentTemplates: [
        {
          id: "template-1",
          category: "auto",
          workspace: "family",
          sourceBudgetKey: "family::item:item-duplicate",
        } as any,
      ],
      commitmentInstances: [
        {
          id: "instance-1",
          category: "auto",
          workspace: "family",
        } as any,
      ],
      movementRules: [
        {
          id: "rule-1",
          amountDirection: "expense",
          category: "auto",
          workspace: "family",
        } as any,
      ],
      importedMovements: [
        {
          id: "movement-1",
          direction: "expense",
          suggestedCategory: "auto",
          suggestedWorkspace: "family",
        } as any,
      ],
    };

    const plan = buildMergeDuplicateCategoriesPlan(input, "category-main", ["category-duplicate"]);

    expect(plan.summary.categoriesDeleted).toBe(1);
    expect(plan.summary.itemsMerged).toBe(1);
    expect(plan.summary.relatedReferencesUpdated).toBe(4);
    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: "update",
          collection: "categories",
          recordId: "category-main",
          patch: expect.objectContaining({ color: "#111111" }),
        }),
        expect.objectContaining({
          op: "update",
          collection: "transactions",
          recordId: "transaction-1",
          patch: expect.objectContaining({
            itemId: "item-main",
            category: "item:item-main",
          }),
        }),
        expect.objectContaining({
          op: "update",
          collection: "budgets",
          recordId: "budget-1",
          patch: expect.objectContaining({ categoryGroup: "item:item-main" }),
        }),
        expect.objectContaining({
          op: "delete",
          collection: "items",
          recordId: "item-duplicate",
        }),
        expect.objectContaining({
          op: "delete",
          collection: "categories",
          recordId: "category-duplicate",
        }),
      ]),
    );
  });
});
