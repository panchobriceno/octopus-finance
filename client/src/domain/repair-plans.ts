import type {
  Budget,
  Category,
  CommitmentInstance,
  CommitmentTemplate,
  ImportedMovement,
  Item,
  MovementRule,
  Transaction,
} from "@shared/schema";

export type RepairCollection =
  | "categories"
  | "items"
  | "transactions"
  | "budgets"
  | "commitmentTemplates"
  | "commitmentInstances"
  | "movementRules"
  | "importedMovements";

export type RepairOperationType = "create" | "update" | "delete";

export type RepairOperation = {
  id: string;
  op: RepairOperationType;
  collection: RepairCollection;
  recordId: string;
  title: string;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  patch?: Record<string, any>;
};

export type RepairPlan = {
  id: string;
  title: string;
  description: string;
  generatedAt: string;
  operations: RepairOperation[];
  summary: Record<string, number | string>;
  warnings?: string[];
};

export type RepairPlanData = {
  categories: Category[];
  items: Item[];
  transactions: Transaction[];
  budgets: Budget[];
  commitmentTemplates?: CommitmentTemplate[];
  commitmentInstances?: CommitmentInstance[];
  movementRules?: MovementRule[];
  importedMovements?: ImportedMovement[];
};

export type BuildBrokenReferencesPlanOptions = {
  createId?: (collection: RepairCollection, hint: string) => string;
};

const ITEM_BUDGET_PREFIX = "item:";
const FALLBACK_CATEGORY_NAME = "Sin categoría";
const SYSTEM_CATEGORY_NAMES = new Set([
  "ingresos clientes",
  "iva por pagar",
  "cuota tarjeta",
  "pago tarjeta",
  "pago tarjeta de credito",
  "transferencia",
  "transferencias",
]);

export function normalizeRepairText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function getWorkspaceKey(value: unknown) {
  return String(value ?? "business");
}

export function isItemBudgetKey(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ITEM_BUDGET_PREFIX);
}

export function getItemBudgetId(value: string | null | undefined) {
  if (!isItemBudgetKey(value)) return null;
  return value.slice(ITEM_BUDGET_PREFIX.length) || null;
}

export function getCategoryMergeKey(category: Pick<Category, "name" | "type" | "workspace">) {
  return `${normalizeRepairText(category.name)}::${category.type}::${getWorkspaceKey(category.workspace)}`;
}

export function summarizeRepairOperations(operations: RepairOperation[]) {
  return operations.reduce<Record<string, number>>((summary, operation) => {
    const key = `${operation.collection}.${operation.op}`;
    summary[key] = (summary[key] ?? 0) + 1;
    summary.total = (summary.total ?? 0) + 1;
    return summary;
  }, { total: 0 });
}

function defaultCreateId(collection: RepairCollection, hint: string) {
  return `preview-${collection}-${normalizeRepairText(hint).replace(/\s+/g, "-") || "new"}`;
}

function makeOperation(
  op: RepairOperationType,
  collection: RepairCollection,
  recordId: string,
  title: string,
  before: Record<string, any> | null,
  after: Record<string, any> | null,
  patch?: Record<string, any>,
): RepairOperation {
  return {
    id: `${collection}:${op}:${recordId}:${normalizeRepairText(title).replace(/\s+/g, "-")}`,
    op,
    collection,
    recordId,
    title,
    before,
    after,
    patch,
  };
}

function makeUpdateOperation<T extends { id: string }>(
  collection: RepairCollection,
  record: T,
  patch: Record<string, any>,
  title: string,
) {
  return makeOperation(
    "update",
    collection,
    record.id,
    title,
    record as Record<string, any>,
    { ...record, ...patch },
    patch,
  );
}

function makeCreateOperation(
  collection: RepairCollection,
  recordId: string,
  after: Record<string, any>,
  title: string,
) {
  return makeOperation("create", collection, recordId, title, null, { id: recordId, ...after });
}

function makeDeleteOperation<T extends { id: string }>(
  collection: RepairCollection,
  record: T,
  title: string,
) {
  return makeOperation("delete", collection, record.id, title, record as Record<string, any>, null);
}

function hasNormalizedName(value: unknown, normalizedNames: Set<string>) {
  const normalized = normalizeRepairText(value);
  return Boolean(normalized) && normalizedNames.has(normalized);
}

export function buildMergeDuplicateCategoriesPlan(
  input: RepairPlanData,
  primaryCategoryId: string,
  duplicateCategoryIds: string[],
): RepairPlan {
  const duplicateIds = Array.from(
    new Set(duplicateCategoryIds.filter((id) => id && id !== primaryCategoryId)),
  );

  if (!primaryCategoryId || duplicateIds.length === 0) {
    throw new Error("Selecciona una categoria principal y al menos una duplicada.");
  }

  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const primaryCategory = categoryById.get(primaryCategoryId);

  if (!primaryCategory) {
    throw new Error("No se encontro la categoria principal.");
  }

  const mergeKey = getCategoryMergeKey(primaryCategory);
  const duplicates = duplicateIds
    .map((id) => categoryById.get(id))
    .filter((category): category is Category => Boolean(category));

  if (duplicates.length !== duplicateIds.length) {
    throw new Error("Una de las categorias duplicadas ya no existe.");
  }

  if (duplicates.some((category) => getCategoryMergeKey(category) !== mergeKey)) {
    throw new Error("Solo se pueden fusionar categorias con el mismo nombre, tipo y ambito.");
  }

  const operations: RepairOperation[] = [];
  const primaryWorkspace = getWorkspaceKey(primaryCategory.workspace);
  const duplicateIdSet = new Set(duplicateIds);
  const duplicateNames = new Set(duplicates.map((category) => normalizeRepairText(category.name)).filter(Boolean));
  const transactionItemUsage = new Map<string, number>();
  const budgetItemUsage = new Map<string, number>();

  for (const transaction of input.transactions) {
    if (!transaction.itemId) continue;
    transactionItemUsage.set(transaction.itemId, (transactionItemUsage.get(transaction.itemId) ?? 0) + 1);
  }

  for (const budget of input.budgets) {
    const itemId = getItemBudgetId(budget.categoryGroup);
    if (!itemId) continue;
    budgetItemUsage.set(itemId, (budgetItemUsage.get(itemId) ?? 0) + 1);
  }

  const primaryCategoryPatch: Record<string, any> = {};
  if (!primaryCategory.color) {
    const color = duplicates.find((category) => category.color)?.color;
    if (color) primaryCategoryPatch.color = color;
  }
  if (Object.keys(primaryCategoryPatch).length > 0) {
    operations.push(makeUpdateOperation("categories", primaryCategory, primaryCategoryPatch, "Completar metadata de categoria principal"));
  }

  const getNextItemCategoryId = (item: Item) =>
    item.categoryId && duplicateIdSet.has(item.categoryId) ? primaryCategory.id : item.categoryId;

  const itemGroups = new Map<string, Item[]>();
  for (const item of input.items) {
    if (getNextItemCategoryId(item) !== primaryCategory.id) continue;
    const normalizedName = normalizeRepairText(item.name);
    if (!normalizedName) continue;
    itemGroups.set(normalizedName, [...(itemGroups.get(normalizedName) ?? []), item]);
  }

  const itemTargetById = new Map<string, string>();
  for (const group of Array.from(itemGroups.values())) {
    if (group.length < 2) continue;

    const [keeper, ...duplicatedItems] = [...group].sort((left, right) => {
      const primaryCategoryDelta =
        Number(right.categoryId === primaryCategory.id) - Number(left.categoryId === primaryCategory.id);
      if (primaryCategoryDelta !== 0) return primaryCategoryDelta;
      const usageDelta =
        ((transactionItemUsage.get(right.id) ?? 0) + (budgetItemUsage.get(right.id) ?? 0)) -
        ((transactionItemUsage.get(left.id) ?? 0) + (budgetItemUsage.get(left.id) ?? 0));
      if (usageDelta !== 0) return usageDelta;
      return left.id.localeCompare(right.id);
    });

    for (const item of duplicatedItems) {
      itemTargetById.set(item.id, keeper.id);
    }
  }

  const itemDeleteIds = new Set<string>();
  for (const item of input.items) {
    if (!item.id || !item.categoryId || !duplicateIdSet.has(item.categoryId)) continue;
    if (itemTargetById.has(item.id)) {
      itemDeleteIds.add(item.id);
      continue;
    }

    operations.push(makeUpdateOperation("items", item, { categoryId: primaryCategory.id }, "Mover item a categoria principal"));
  }

  for (const itemId of Array.from(itemTargetById.keys())) {
    itemDeleteIds.add(itemId);
  }

  const shouldRenameNamedCategory = (value: unknown, workspace: unknown, type?: unknown) => {
    if (isItemBudgetKey(value)) return false;
    if (!hasNormalizedName(value, duplicateNames)) return false;
    if (String(value ?? "") === primaryCategory.name) return false;
    if (getWorkspaceKey(workspace) !== primaryWorkspace) return false;
    if (type && String(type) !== primaryCategory.type) return false;
    return true;
  };

  for (const transaction of input.transactions) {
    const patch: Record<string, any> = {};
    const nextItemId = transaction.itemId ? itemTargetById.get(transaction.itemId) : null;

    if (nextItemId) {
      patch.itemId = nextItemId;
    }

    const categoryItemId = getItemBudgetId(transaction.category);
    if (categoryItemId && itemTargetById.has(categoryItemId)) {
      patch.category = `${ITEM_BUDGET_PREFIX}${itemTargetById.get(categoryItemId)}`;
    } else if (shouldRenameNamedCategory(transaction.category, transaction.workspace, transaction.type)) {
      patch.category = primaryCategory.name;
    }

    if (Object.keys(patch).length > 0) {
      operations.push(makeUpdateOperation("transactions", transaction, patch, "Actualizar referencia de movimiento"));
    }
  }

  const resolveCategoryGroup = (categoryGroup: string, workspace: unknown) => {
    const itemId = getItemBudgetId(categoryGroup);
    if (itemId && itemTargetById.has(itemId)) {
      return `${ITEM_BUDGET_PREFIX}${itemTargetById.get(itemId)}`;
    }
    if (shouldRenameNamedCategory(categoryGroup, workspace)) {
      return primaryCategory.name;
    }
    return categoryGroup;
  };

  const budgetGroups = new Map<string, Array<{ budget: Budget; categoryGroup: string }>>();
  for (const budget of input.budgets) {
    const workspace = getWorkspaceKey(budget.workspace);
    const nextCategoryGroup = resolveCategoryGroup(budget.categoryGroup, workspace);
    const key = `${budget.year}::${budget.month}::${workspace}::${nextCategoryGroup}`;
    budgetGroups.set(key, [...(budgetGroups.get(key) ?? []), { budget, categoryGroup: nextCategoryGroup }]);
  }

  for (const group of Array.from(budgetGroups.values())) {
    if (group.length === 1) {
      const [{ budget, categoryGroup }] = group;
      if (budget.categoryGroup !== categoryGroup) {
        operations.push(makeUpdateOperation("budgets", budget, { categoryGroup }, "Actualizar grupo de presupuesto"));
      }
      continue;
    }

    const [keeper, ...duplicatesToDelete] = [...group].sort((left, right) => {
      const alreadyCanonicalDelta =
        Number(right.budget.categoryGroup === right.categoryGroup) - Number(left.budget.categoryGroup === left.categoryGroup);
      if (alreadyCanonicalDelta !== 0) return alreadyCanonicalDelta;
      const activeDelta = Number(!right.budget.isArchived) - Number(!left.budget.isArchived);
      if (activeDelta !== 0) return activeDelta;
      const recurringDelta = Number(Boolean(right.budget.isRecurring)) - Number(Boolean(left.budget.isRecurring));
      if (recurringDelta !== 0) return recurringDelta;
      return left.budget.id.localeCompare(right.budget.id);
    });

    const dayOfMonth = group
      .map(({ budget }) => budget.dayOfMonth)
      .find((day) => Number.isFinite(Number(day)));
    const order = group
      .map(({ budget }) => budget.order)
      .find((value) => Number.isFinite(Number(value)));
    const patch: Record<string, any> = {
      categoryGroup: keeper.categoryGroup,
      amount: group.reduce((total, { budget }) => total + (Number(budget.amount) || 0), 0),
      isRecurring: group.some(({ budget }) => Boolean(budget.isRecurring)),
      isArchived: group.every(({ budget }) => Boolean(budget.isArchived)),
    };
    if (dayOfMonth !== undefined) patch.dayOfMonth = dayOfMonth;
    if (order !== undefined) patch.order = order;

    operations.push(makeUpdateOperation("budgets", keeper.budget, patch, "Fusionar presupuestos duplicados"));

    for (const { budget } of duplicatesToDelete) {
      operations.push(makeDeleteOperation("budgets", budget, "Eliminar presupuesto fusionado"));
    }
  }

  const resolveSourceBudgetKey = (sourceBudgetKey: string | null | undefined, fallbackWorkspace: unknown) => {
    if (!sourceBudgetKey) return sourceBudgetKey;
    const separatorIndex = sourceBudgetKey.indexOf("::");
    if (separatorIndex === -1) return sourceBudgetKey;

    const workspace = sourceBudgetKey.slice(0, separatorIndex) || getWorkspaceKey(fallbackWorkspace);
    const categoryGroup = sourceBudgetKey.slice(separatorIndex + 2);
    const nextCategoryGroup = resolveCategoryGroup(categoryGroup, workspace);
    if (nextCategoryGroup === categoryGroup) return sourceBudgetKey;
    return `${workspace}::${nextCategoryGroup}`;
  };

  for (const template of input.commitmentTemplates ?? []) {
    const patch: Record<string, any> = {};
    if (shouldRenameNamedCategory(template.category, template.workspace)) {
      patch.category = primaryCategory.name;
    }
    const nextSourceBudgetKey = resolveSourceBudgetKey(template.sourceBudgetKey, template.workspace);
    if (nextSourceBudgetKey !== template.sourceBudgetKey) {
      patch.sourceBudgetKey = nextSourceBudgetKey;
    }
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date().toISOString();
      operations.push(makeUpdateOperation("commitmentTemplates", template, patch, "Actualizar plantilla de compromiso"));
    }
  }

  for (const instance of input.commitmentInstances ?? []) {
    if (!shouldRenameNamedCategory(instance.category, instance.workspace)) continue;
    operations.push(
      makeUpdateOperation(
        "commitmentInstances",
        instance,
        { category: primaryCategory.name, updatedAt: new Date().toISOString() },
        "Actualizar compromiso mensual",
      ),
    );
  }

  for (const rule of input.movementRules ?? []) {
    if (rule.amountDirection !== "any" && rule.amountDirection !== primaryCategory.type) continue;
    if (!shouldRenameNamedCategory(rule.category, rule.workspace)) continue;
    operations.push(
      makeUpdateOperation(
        "movementRules",
        rule,
        { category: primaryCategory.name, updatedAt: new Date().toISOString() },
        "Actualizar regla de importacion",
      ),
    );
  }

  for (const movement of input.importedMovements ?? []) {
    if (movement.direction !== primaryCategory.type) continue;
    if (!shouldRenameNamedCategory(movement.suggestedCategory, movement.suggestedWorkspace)) continue;
    operations.push(
      makeUpdateOperation(
        "importedMovements",
        movement,
        { suggestedCategory: primaryCategory.name, updatedAt: new Date().toISOString() },
        "Actualizar movimiento importado",
      ),
    );
  }

  for (const itemId of Array.from(itemDeleteIds)) {
    const item = input.items.find((candidate) => candidate.id === itemId);
    if (item) operations.push(makeDeleteOperation("items", item, "Eliminar item fusionado"));
  }

  for (const category of duplicates) {
    operations.push(makeDeleteOperation("categories", category, "Eliminar categoria duplicada"));
  }

  return {
    id: `merge-categories:${primaryCategory.id}:${duplicateIds.join(",")}`,
    title: `Fusionar "${primaryCategory.name}"`,
    description: `Conserva ${primaryCategory.name} y consolida ${duplicates.length} categorias duplicadas.`,
    generatedAt: new Date().toISOString(),
    operations,
    summary: {
      ...summarizeRepairOperations(operations),
      primaryCategoryId,
      primaryCategoryName: primaryCategory.name,
      categoriesDeleted: duplicates.length,
      itemsUpdated: operations.filter((operation) => operation.collection === "items" && operation.op === "update").length,
      itemsMerged: itemDeleteIds.size,
      transactionsUpdated: operations.filter((operation) => operation.collection === "transactions").length,
      budgetsUpdated: operations.filter((operation) => operation.collection === "budgets" && operation.op === "update").length,
      budgetsDeleted: operations.filter((operation) => operation.collection === "budgets" && operation.op === "delete").length,
      relatedReferencesUpdated: operations.filter((operation) =>
        ["commitmentTemplates", "commitmentInstances", "movementRules", "importedMovements"].includes(operation.collection),
      ).length,
    },
  };
}

export function buildBrokenReferencesPlan(
  input: RepairPlanData,
  options: BuildBrokenReferencesPlanOptions = {},
): RepairPlan {
  const createId = options.createId ?? defaultCreateId;
  const operations: RepairOperation[] = [];
  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const categoryNames = new Set(input.categories.map((category) => normalizeRepairText(category.name)));
  const categoryByRepairKey = new Map(
    input.categories.map((category) => [getCategoryMergeKey(category), category.id]),
  );
  let categoriesCreated = 0;
  let itemsReassigned = 0;
  let transactionsUpdated = 0;
  let budgetsUpdated = 0;

  const ensureCategory = (name: string, type: unknown, workspace: unknown) => {
    const categoryName = name.trim() || FALLBACK_CATEGORY_NAME;
    const categoryType = type === "income" ? "income" : "expense";
    const categoryWorkspace = getWorkspaceKey(workspace);
    const repairKey = `${normalizeRepairText(categoryName)}::${categoryType}::${categoryWorkspace}`;
    const existingId = categoryByRepairKey.get(repairKey);
    if (existingId) return existingId;

    const recordId = createId("categories", repairKey);
    const payload = {
      name: categoryName,
      type: categoryType,
      workspace: categoryWorkspace,
      color: categoryName === FALLBACK_CATEGORY_NAME ? "#64748b" : "#8b5cf6",
    };

    categoryByRepairKey.set(repairKey, recordId);
    categoryNames.add(normalizeRepairText(categoryName));
    operations.push(makeCreateOperation("categories", recordId, payload, `Crear categoria ${categoryName}`));
    categoriesCreated += 1;
    return recordId;
  };

  const inferItemContext = (itemId: string) => {
    const linkedTransaction = input.transactions.find((transaction) => transaction.itemId === itemId);
    const linkedBudget = input.budgets.find((budget) => getItemBudgetId(budget.categoryGroup) === itemId);
    return {
      type: linkedTransaction?.type === "income" ? "income" : "expense",
      workspace: linkedTransaction?.workspace ?? linkedBudget?.workspace ?? "business",
    };
  };

  for (const item of input.items) {
    if (item.categoryId && categoryById.has(item.categoryId)) continue;

    const context = inferItemContext(item.id);
    const categoryId = ensureCategory(FALLBACK_CATEGORY_NAME, context.type, context.workspace);
    operations.push(makeUpdateOperation("items", item, { categoryId }, "Reasignar item sin categoria valida"));
    itemsReassigned += 1;
  }

  for (const transaction of input.transactions) {
    const patch: Record<string, any> = {};
    if (transaction.itemId && !itemById.has(transaction.itemId)) {
      patch.itemId = null;
      if (transaction.category === `${ITEM_BUDGET_PREFIX}${transaction.itemId}`) {
        ensureCategory(FALLBACK_CATEGORY_NAME, transaction.type, transaction.workspace);
        patch.category = FALLBACK_CATEGORY_NAME;
      }
    }

    const normalizedCategory = normalizeRepairText(patch.category ?? transaction.category);
    if (
      transaction.category &&
      !isItemBudgetKey(patch.category ?? transaction.category) &&
      transaction.status !== "cancelled" &&
      !categoryNames.has(normalizedCategory) &&
      !SYSTEM_CATEGORY_NAMES.has(normalizedCategory)
    ) {
      ensureCategory(transaction.category, transaction.type, transaction.workspace);
    }

    if (Object.keys(patch).length > 0) {
      operations.push(makeUpdateOperation("transactions", transaction, patch, "Reparar referencia de movimiento"));
      transactionsUpdated += 1;
    }
  }

  for (const budget of input.budgets) {
    const itemId = getItemBudgetId(budget.categoryGroup);
    if (itemId && !itemById.has(itemId)) {
      ensureCategory(FALLBACK_CATEGORY_NAME, "expense", budget.workspace);
      operations.push(makeUpdateOperation("budgets", budget, { categoryGroup: FALLBACK_CATEGORY_NAME }, "Mover presupuesto sin item"));
      budgetsUpdated += 1;
      continue;
    }

    if (!itemId && !categoryNames.has(normalizeRepairText(budget.categoryGroup))) {
      ensureCategory(budget.categoryGroup, "expense", budget.workspace);
    }
  }

  return {
    id: "repair-broken-references",
    title: "Reparar referencias rotas",
    description: "Crea categorias faltantes y repunta registros que quedaron con referencias inexistentes.",
    generatedAt: new Date().toISOString(),
    operations,
    summary: {
      ...summarizeRepairOperations(operations),
      categoriesCreated,
      itemsReassigned,
      transactionsUpdated,
      budgetsUpdated,
    },
  };
}
