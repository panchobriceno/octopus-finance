import { describe, expect, it } from "vitest";
import type { Category, Item } from "@shared/schema";
import { buildQuickExpenseTransaction, inferQuickExpenseCategoryId } from "../quick-expense";

const categories: Category[] = [
  { id: "cat-food", name: "Comida", type: "expense", color: null, workspace: "family" },
  { id: "cat-auto", name: "Auto", type: "expense", color: null, workspace: "family" },
  { id: "cat-income", name: "Ingresos", type: "income", color: null, workspace: "business" },
];

const item: Item = {
  id: "item-lunch",
  name: "Almuerzo",
  categoryId: "cat-food",
};

describe("quick expense domain", () => {
  it("infers expense categories from receipt signals", () => {
    expect(inferQuickExpenseCategoryId(categories, ["Uber Eats", "restaurant"])).toBe("cat-food");
    expect(inferQuickExpenseCategoryId(categories, ["Copec Las Condes", "combustible"])).toBe("cat-auto");
  });

  it("builds a pending credit-card expense payload", () => {
    const tx = buildQuickExpenseTransaction(
      {
        name: "Jumbo Bilbao",
        categoryId: "cat-food",
        itemId: "item-lunch",
        amount: 35990,
        date: "2026-06-24",
        workspace: "family",
        paymentMethod: "credit_card",
        accountId: null,
        creditCardName: "Santander World",
        installmentCount: 2,
        notes: "OCR: compra supermercado",
      },
      categories[0],
      item,
    );

    expect(tx).toMatchObject({
      name: "Jumbo Bilbao",
      category: "Comida",
      amount: 35990,
      type: "expense",
      status: "pending",
      movementType: "expense",
      paymentMethod: "credit_card",
      accountId: null,
      creditCardName: "Santander World",
      installmentCount: 2,
      itemId: "item-lunch",
      sourceCommitmentInstanceId: null,
    });
  });
});
