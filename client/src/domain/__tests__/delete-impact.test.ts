import { describe, expect, it } from "vitest";
import type { Category, Item } from "@shared/schema";
import { countCategoryDeleteImpact, countItemDeleteImpact, sumDeleteImpact } from "../delete-impact";

const category: Category = {
  id: "cat-food",
  name: "Comida",
  type: "expense",
  color: "#fff",
  workspace: "family",
};

const item: Item = {
  id: "item-super",
  name: "Supermercado",
  categoryId: category.id,
};

describe("delete impact", () => {
  it("counts category references before deletion", () => {
    const counts = countCategoryDeleteImpact({
      category,
      items: [item],
      transactions: [
        { id: "tx-1", category: "Comida", type: "expense", workspace: "family" } as any,
        { id: "tx-2", category: "Comida", type: "expense", workspace: "business" } as any,
      ],
      budgets: [
        { id: "budget-1", categoryGroup: "Comida", workspace: "family" } as any,
        { id: "budget-2", categoryGroup: "Comida", workspace: "business" } as any,
      ],
      commitmentTemplates: [
        { id: "template-1", category: "Comida", movementType: "expense", workspace: "family" } as any,
      ],
      commitmentInstances: [
        { id: "instance-1", category: "Comida", movementType: "expense", workspace: "family" } as any,
      ],
      movementRules: [
        { id: "rule-1", category: "Comida", movementType: "expense", workspace: "family" } as any,
      ],
      importedMovements: [
        {
          id: "movement-1",
          suggestedCategory: "Comida",
          suggestedMovementType: "expense",
          suggestedWorkspace: "family",
        } as any,
      ],
    });

    expect(counts).toEqual({
      items: 1,
      transactions: 1,
      budgets: 1,
      commitmentTemplates: 1,
      commitmentInstances: 1,
      movementRules: 1,
      importedMovements: 1,
    });
    expect(sumDeleteImpact(counts)).toBe(7);
  });

  it("counts item references before deletion", () => {
    const counts = countItemDeleteImpact({
      item,
      transactions: [{ id: "tx-1", itemId: item.id } as any],
      budgets: [{ id: "budget-1", categoryGroup: `item:${item.id}` } as any],
      commitmentTemplates: [{ id: "template-1", sourceBudgetKey: `family::item:${item.id}` } as any],
      commitmentInstances: [{ id: "instance-1", templateId: "template-1" } as any],
      movementRules: [{ id: "rule-1", itemId: item.id } as any],
      importedMovements: [{ id: "movement-1", suggestedItemId: item.id } as any],
    });

    expect(counts).toEqual({
      transactions: 1,
      budgets: 1,
      commitmentTemplates: 1,
      commitmentInstances: 1,
      movementRules: 1,
      importedMovements: 1,
    });
  });
});
