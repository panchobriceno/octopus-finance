import { describe, expect, it } from "vitest";
import type { Category, Item } from "@shared/schema";
import {
  categoryTypeForMovementType,
  isRuleItemConsistent,
  itemsForRuleCategory,
  parseRuleKeywords,
  resolveRuleCategoryId,
  sanitizeRuleItemId,
} from "../movement-rules";

const cat = (id: string, name: string, type: "income" | "expense", workspace?: string): Category => ({
  id,
  name,
  type,
  color: null,
  workspace: workspace ?? null,
});

const item = (id: string, name: string, categoryId: string | null): Item => ({ id, name, categoryId });

// Catálogo de prueba: nombre "Servicios" colisiona entre egreso e ingreso y entre workspaces.
const categories: Category[] = [
  cat("c-exp-business", "Servicios", "expense", "business"),
  cat("c-exp-family", "Servicios", "expense", "family"),
  cat("c-inc", "Servicios", "income", "business"),
  cat("c-food", "Comida", "expense"),
];

const items: Item[] = [
  item("i-luz", "Luz", "c-exp-business"),
  item("i-agua", "Agua", "c-exp-family"),
  item("i-sueldo", "Sueldo", "c-inc"),
  item("i-almuerzo", "Almuerzo", "c-food"),
  item("i-huerfano", "Huérfano", null),
];

describe("categoryTypeForMovementType", () => {
  it("solo income mapea a income; el resto a expense", () => {
    expect(categoryTypeForMovementType("income")).toBe("income");
    expect(categoryTypeForMovementType("expense")).toBe("expense");
    expect(categoryTypeForMovementType("transfer")).toBe("expense");
    expect(categoryTypeForMovementType("credit_card_payment")).toBe("expense");
    expect(categoryTypeForMovementType(undefined)).toBe("expense");
  });
});

describe("resolveRuleCategoryId", () => {
  it("resuelve por nombre + tipo + workspace", () => {
    expect(resolveRuleCategoryId(categories, "Servicios", "expense", "family")).toBe("c-exp-family");
    expect(resolveRuleCategoryId(categories, "Servicios", "expense", "business")).toBe("c-exp-business");
  });

  it("el tipo desambigua entre categorías del mismo nombre (income vs expense)", () => {
    expect(resolveRuleCategoryId(categories, "Servicios", "income", "business")).toBe("c-inc");
    expect(resolveRuleCategoryId(categories, "Servicios", "expense", "business")).toBe("c-exp-business");
  });

  it("transfer y credit_card_payment resuelven contra el lado de egresos", () => {
    expect(resolveRuleCategoryId(categories, "Servicios", "transfer", "family")).toBe("c-exp-family");
    expect(resolveRuleCategoryId(categories, "Servicios", "credit_card_payment", "business")).toBe("c-exp-business");
  });

  it("cae al match sin workspace cuando no hay coincidencia exacta", () => {
    expect(resolveRuleCategoryId(categories, "Servicios", "expense", "dentist")).toBe("c-exp-business");
  });

  it("normaliza acentos y mayúsculas del nombre", () => {
    expect(resolveRuleCategoryId(categories, "  SERVICIOS ", "expense", "family")).toBe("c-exp-family");
  });

  it("devuelve null si el nombre no existe o viene vacío", () => {
    expect(resolveRuleCategoryId(categories, "Inexistente", "expense", "family")).toBeNull();
    expect(resolveRuleCategoryId(categories, "", "expense", "family")).toBeNull();
    expect(resolveRuleCategoryId(categories, null, "expense", "family")).toBeNull();
  });
});

describe("itemsForRuleCategory", () => {
  it("devuelve solo los items de la categoría resuelta", () => {
    expect(itemsForRuleCategory(categories, items, "Comida", "expense", "family").map((i) => i.id)).toEqual([
      "i-almuerzo",
    ]);
  });

  it("devuelve [] si la categoría no existe", () => {
    expect(itemsForRuleCategory(categories, items, "Inexistente", "expense", "family")).toEqual([]);
  });
});

describe("isRuleItemConsistent", () => {
  it("itemId vacío o null siempre es consistente", () => {
    expect(isRuleItemConsistent(categories, items, "Comida", "expense", "family", null)).toBe(true);
    expect(isRuleItemConsistent(categories, items, "Comida", "expense", "family", "")).toBe(true);
  });

  it("item que pertenece a la categoría resuelta es consistente", () => {
    expect(isRuleItemConsistent(categories, items, "Comida", "expense", "family", "i-almuerzo")).toBe(true);
  });

  it("item de otra categoría es inconsistente", () => {
    expect(isRuleItemConsistent(categories, items, "Comida", "expense", "family", "i-luz")).toBe(false);
  });

  it("item válido pero categoría inexistente es inconsistente", () => {
    expect(isRuleItemConsistent(categories, items, "Inexistente", "expense", "family", "i-luz")).toBe(false);
  });

  it("item huérfano (categoryId null) es inconsistente con cualquier categoría", () => {
    expect(isRuleItemConsistent(categories, items, "Comida", "expense", "family", "i-huerfano")).toBe(false);
  });
});

describe("sanitizeRuleItemId", () => {
  it("conserva el itemId consistente", () => {
    expect(sanitizeRuleItemId(categories, items, "Comida", "expense", "family", "i-almuerzo")).toBe("i-almuerzo");
  });

  it("limpia (null) el itemId inconsistente — regla legacy rota", () => {
    expect(sanitizeRuleItemId(categories, items, "Comida", "expense", "family", "i-luz")).toBeNull();
    expect(sanitizeRuleItemId(categories, items, "Inexistente", "expense", "family", "i-luz")).toBeNull();
  });

  it("null in, null out", () => {
    expect(sanitizeRuleItemId(categories, items, "Comida", "expense", "family", null)).toBeNull();
  });
});

describe("parseRuleKeywords", () => {
  it("trimea, descarta vacíos y deduplica por forma normalizada", () => {
    expect(parseRuleKeywords("  Uber ,uber, , UBER , cornershop")).toEqual(["Uber", "cornershop"]);
  });

  it("string vacío → []", () => {
    expect(parseRuleKeywords("")).toEqual([]);
    expect(parseRuleKeywords("  , , ")).toEqual([]);
  });
});
