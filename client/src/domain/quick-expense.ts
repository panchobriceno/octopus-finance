import type { Category, Item, Transaction } from "@shared/schema";
import type { Workspace } from "@/lib/finance";

export type QuickExpensePaymentMethod = "bank_account" | "credit_card" | "cash";

export type QuickExpenseDraft = {
  name: string;
  categoryId: string;
  itemId: string;
  amount: number;
  date: string;
  workspace: Workspace;
  paymentMethod: QuickExpensePaymentMethod;
  accountId: string | null;
  creditCardName: string | null;
  installmentCount: number | null;
  notes: string | null;
};

const CATEGORY_HINTS: Array<{ keywords: string[]; categoryNames: string[] }> = [
  {
    keywords: ["restaurant", "restaurante", "comida", "cafe", "cafeteria", "uber eats", "rappi", "pedido"],
    categoryNames: ["Comida", "Alimentacion", "Restaurantes"],
  },
  {
    keywords: ["supermercado", "lider", "jumbo", "unimarc", "tottus", "santa isabel"],
    categoryNames: ["Supermercado", "Comida", "Hogar"],
  },
  {
    keywords: ["bencina", "combustible", "copec", "shell", "petrobras", "auto"],
    categoryNames: ["Bencina", "Auto", "Transporte"],
  },
  {
    keywords: ["farmacia", "salud", "clinica", "doctor", "consulta"],
    categoryNames: ["Salud", "Consulta", "Farmacia"],
  },
  {
    keywords: ["netflix", "spotify", "apple", "google", "digital", "software"],
    categoryNames: ["Digital", "Software", "Suscripciones"],
  },
  {
    keywords: ["uber", "cabify", "metro", "transporte", "estacionamiento"],
    categoryNames: ["Transporte", "Auto"],
  },
  {
    keywords: ["homecenter", "sodimac", "easy", "hogar"],
    categoryNames: ["Hogar", "Mantencion"],
  },
];

export function normalizeQuickExpenseText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchCategoryByName(categories: Category[], names: string[]) {
  const normalizedNames = names.map(normalizeQuickExpenseText).filter(Boolean);
  if (!normalizedNames.length) return null;

  return categories.find((category) => {
    const categoryName = normalizeQuickExpenseText(category.name);
    return normalizedNames.some((name) => categoryName === name || categoryName.includes(name) || name.includes(categoryName));
  }) ?? null;
}

export function inferQuickExpenseCategoryId(categories: Category[], signals: Array<string | null | undefined>) {
  const expenseCategories = categories.filter((category) => category.type === "expense");
  const normalizedSignals = signals.map(normalizeQuickExpenseText).filter(Boolean);
  const directMatch = matchCategoryByName(expenseCategories, normalizedSignals);
  if (directMatch) return directMatch.id;

  const haystack = normalizedSignals.join(" ");
  for (const hint of CATEGORY_HINTS) {
    const matchesHint = hint.keywords.some((keyword) => haystack.includes(normalizeQuickExpenseText(keyword)));
    if (!matchesHint) continue;

    const hintedCategory = matchCategoryByName(expenseCategories, hint.categoryNames);
    if (hintedCategory) return hintedCategory.id;
  }

  return "";
}

export function buildQuickExpenseTransaction(
  draft: QuickExpenseDraft,
  category: Category | null,
  item: Item | null,
): Omit<Transaction, "id"> {
  const name = draft.name.trim() || item?.name || category?.name || "Gasto rapido";
  const categoryName = category?.name ?? "Sin categoria";
  const isCreditCard = draft.paymentMethod === "credit_card";

  return {
    name,
    category: categoryName,
    amount: draft.amount,
    type: "expense",
    date: draft.date,
    notes: draft.notes,
    subtype: "actual",
    status: isCreditCard ? "pending" : "paid",
    itemId: item?.id ?? null,
    workspace: draft.workspace,
    movementType: "expense",
    paymentMethod: draft.paymentMethod,
    destinationWorkspace: null,
    destinationAccountId: null,
    accountId: draft.paymentMethod === "bank_account" ? draft.accountId : null,
    creditCardName: isCreditCard ? draft.creditCardName : null,
    installmentCount: isCreditCard ? draft.installmentCount ?? 1 : null,
    sourceClientPaymentId: null,
    sourceCommitmentInstanceId: null,
    sourceCommitmentTemplateId: null,
    importBatchId: null,
    importBatchLabel: null,
    importedAt: null,
  };
}
