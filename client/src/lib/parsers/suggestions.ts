import { normalizeText } from "./csv-core";
import type { AccountType, CategoryRef, ImportWorkspace, ParsedPreviewRow } from "./types";

export const TC_PAYMENT_KEYWORDS = [
  "pago pesos tef",
  "pago pap",
  "pago cuenta corriente",
  "pago pesos",
  "pago pac",
];

const SUGGESTED_FAMILY_EXPENSE_CATEGORIES = [
  "Comida",
  "Seguros",
  "Otros",
  "Intereses bancarios",
  "Comisiones bancarias",
  "Viajes",
  "Transporte",
  "Pago tarjeta",
];

export function findCategoryName(
  categories: CategoryRef[],
  name: string,
  workspace: "family" | "business" = "family",
) {
  return categories.find((category) =>
    category.type === "expense" &&
    category.name.toLowerCase() === name.toLowerCase() &&
    // Sin ámbito = compartida → válida en cualquier ámbito.
    (!category.workspace || category.workspace === workspace),
  )?.name;
}

export function suggestExpenseCategory(description: string, categories: CategoryRef[]) {
  const normalized = normalizeText(description);

  if (normalized.includes("uber eats") || normalized.includes("uber trip")) {
    return findCategoryName(categories, "Comida") ?? "Comida";
  }

  if (
    normalized.includes("seguros") ||
    normalized.includes("seguro") ||
    normalized.includes("kushkiseguros") ||
    normalized.includes("banchile seguros")
  ) {
    return findCategoryName(categories, "Seguros") ?? "Seguros";
  }

  if (normalized.includes("intereses")) {
    return findCategoryName(categories, "Intereses bancarios") ?? "Intereses bancarios";
  }

  if (
    normalized.includes("comision") ||
    normalized.includes("mantencion") ||
    normalized.includes("impuesto decreto ley 3475")
  ) {
    return findCategoryName(categories, "Comisiones bancarias") ?? "Comisiones bancarias";
  }

  if (
    normalized.includes("american airlines") ||
    normalized.includes("airlines") ||
    normalized.includes("sky") ||
    normalized.includes("latam") ||
    normalized.includes("travel")
  ) {
    return findCategoryName(categories, "Viajes") ?? findCategoryName(categories, "Otros") ?? "Otros";
  }

  if (
    normalized.includes("mercadopago") ||
    normalized.includes("mercado") ||
    normalized.includes("aliexpress") ||
    normalized.includes("apple.com") ||
    normalized.includes("paris")
  ) {
    return findCategoryName(categories, "Otros") ?? "Otros";
  }

  if (
    normalized.includes("pago pesos") ||
    normalized.includes("pago pap") ||
    normalized.includes("tef")
  ) {
    return findCategoryName(categories, "Pago tarjeta") ?? "Pago tarjeta";
  }

  return findCategoryName(categories, "Otros") ?? "Otros";
}

export function suggestRowCategory(
  name: string,
  type: ParsedPreviewRow["type"],
  categories: CategoryRef[],
) {
  if (type === "credit_card_payment") {
    return findCategoryName(categories, "Pago tarjeta") ?? "Pago tarjeta";
  }

  if (type === "income") {
    return categories.find((category) => category.type === "income")?.name ?? "Sin categoría";
  }

  return suggestExpenseCategory(name, categories);
}

export function suggestRowType(name: string, fallbackType: "income" | "expense") {
  const normalized = normalizeText(name);

  if (
    normalized.includes("pago pesos") ||
    normalized.includes("pago pap") ||
    normalized.includes("tef") ||
    normalized.includes("traspaso deuda")
  ) {
    return "credit_card_payment" as const;
  }

  return fallbackType;
}

export function getDefaultExpenseCategoryOptions() {
  return SUGGESTED_FAMILY_EXPENSE_CATEGORIES;
}

export function suggestWorkspace(
  description: string,
  category: string,
  type: ParsedPreviewRow["type"],
  accountType: AccountType,
  defaultWorkspace: ImportWorkspace,
): ImportWorkspace {
  const normalizedCategory = normalizeText(category);
  const normalizedDescription = normalizeText(description);

  if (type === "income") {
    return "business" as const;
  }

  if (
    accountType === "credit" &&
    (
      normalizedDescription.includes("uber eats") ||
      normalizedDescription.includes("uber trip")
    )
  ) {
    return "family" as const;
  }

  if (normalizedCategory === "empresa") {
    return "business" as const;
  }

  if (accountType === "credit") {
    return defaultWorkspace;
  }

  return "business" as const;
}

export function categoryMatchesType(
  categoryName: string,
  type: ParsedPreviewRow["type"],
  categories: Pick<CategoryRef, "name" | "type">[],
) {
  if (!categoryName || categoryName === "Sin categoría") return false;

  if (type === "credit_card_payment") {
    return true;
  }

  const matched = categories.find((category) => category.name === categoryName);
  if (!matched) {
    return type !== "income";
  }

  return matched.type === type;
}
