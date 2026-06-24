/**
 * Firestore data layer — replaces Express API + MemStorage.
 * Uses Firebase modular SDK v9.
 */
import type {
  Account,
  Budget,
  Category,
  Client,
  ClientPayment,
  CommitmentInstance,
  CommitmentTemplate,
  InsertMonthlyCloseSnapshot,
  ImportBatch,
  ImportedMovement,
  Item,
  MovementRule,
  MonthlyCloseSnapshot,
  Transaction,
} from "@shared/schema";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  writeBatch,
  query,
  orderBy,
  where,
  limit,
  type QuerySnapshot,
  type DocumentSnapshot,
  type DocumentData,
  type Transaction as FirestoreTransaction,
} from "firebase/firestore/lite";
import { db } from "./firebase";
import { getCurrentMonthKey } from "./finance";
import {
  buildImportedMovement,
  buildTransactionFromImportedMovement,
  buildTransactionMatchKey,
  findMatchingTransactionForPayload,
  findBestMovementRule,
  applyMovementRule,
  type ImportedMovementOverride,
  type MovementSeedInput,
} from "@/domain/bank-imports";
import {
  buildMissingCommitmentInstances,
  findCommitmentMatches,
} from "@/domain/commitments";
import {
  buildBrokenReferencesPlan,
  buildMergeDuplicateCategoriesPlan,
  type RepairCollection,
  type RepairOperation,
  type RepairPlan,
} from "@/domain/repair-plans";

export type ImportedMovementBatchRow = Omit<
  MovementSeedInput,
  "batchId" | "createdAt" | "source" | "sourceName" | "sourceType"
> & {
  source?: string;
  sourceName?: string;
  sourceType?: "bank_account" | "credit_card";
};

export type CreateImportedMovementBatchInput = {
  label: string;
  source?: string;
  sourceName: string;
  sourceType: "bank_account" | "credit_card";
  bankName?: string | null;
  accountId?: string | null;
  creditCardName?: string | null;
  workspace?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
  isDemo?: boolean;
  movements: ImportedMovementBatchRow[];
};

// ── Helper: map Firestore snapshot to typed array ───────────────
function snapToArray<T>(snap: QuerySnapshot<DocumentData>): T[] {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getCategoryMergeKey(category: Pick<Category, "name" | "type" | "workspace">) {
  return `${normalizeText(category.name)}::${category.type}::${category.workspace ?? "business"}`;
}

function getWorkspaceKey(value: unknown) {
  return String(value ?? "business");
}

function hasNormalizedName(value: unknown, normalizedNames: Set<string>) {
  const normalized = normalizeText(value);
  return Boolean(normalized) && normalizedNames.has(normalized);
}

async function commitWriteOperations(
  operations: Array<(batch: ReturnType<typeof writeBatch>) => void>,
) {
  for (let i = 0; i < operations.length; i += 450) {
    const batch = writeBatch(db);
    operations.slice(i, i + 450).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

// ── Collection references ───────────────────────────────────────
const transactionsCol = () => collection(db, "transactions");
const categoriesCol = () => collection(db, "categories");
const itemsCol = () => collection(db, "items");
const budgetsCol = () => collection(db, "budgets");
const openingBalancesCol = () => collection(db, "openingBalances");
const clientPaymentsCol = () => collection(db, "clientPayments");
const clientsCol = () => collection(db, "clients");
const accountsCol = () => collection(db, "accounts");
const creditCardSettingsCol = () => collection(db, "credit_card_settings");
const commitmentTemplatesCol = () => collection(db, "commitmentTemplates");
const commitmentInstancesCol = () => collection(db, "commitmentInstances");
const monthlyCloseSnapshotsCol = () => collection(db, "monthlyCloseSnapshots");
const importBatchesCol = () => collection(db, "importBatches");
const importedMovementsCol = () => collection(db, "importedMovements");
const movementRulesCol = () => collection(db, "movementRules");
const preferencesDoc = () => doc(db, "preferences", "dashboard");
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

function repairCollectionDoc(collectionName: RepairCollection, id: string) {
  const collectionPaths: Record<RepairCollection, string> = {
    categories: "categories",
    items: "items",
    transactions: "transactions",
    budgets: "budgets",
    commitmentTemplates: "commitmentTemplates",
    commitmentInstances: "commitmentInstances",
    movementRules: "movementRules",
    importedMovements: "importedMovements",
  };
  return doc(db, collectionPaths[collectionName], id);
}

function stripDocumentId(record: Record<string, any>) {
  const { id: _id, ...data } = record;
  return data;
}

function normalizeComparableValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((entry) => normalizeComparableValue(entry));
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "__NaN__";
    if (value === Infinity) return "__Infinity__";
    if (value === -Infinity) return "__-Infinity__";
    return value;
  }
  if (typeof value !== "object") return value;

  if (value instanceof Date) return value.toISOString();

  const record = value as Record<string, any>;
  if (typeof record.seconds === "number" && typeof record.nanoseconds === "number") {
    return { seconds: record.seconds, nanoseconds: record.nanoseconds };
  }
  if (typeof record._seconds === "number" && typeof record._nanoseconds === "number") {
    return { seconds: record._seconds, nanoseconds: record._nanoseconds };
  }

  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const normalized = normalizeComparableValue(record[key]);
      if (normalized !== undefined) acc[key] = normalized;
      return acc;
    }, {});
}

function repairRecordsMatch(left: Record<string, any> | null, right: Record<string, any> | null) {
  return JSON.stringify(normalizeComparableValue(left)) === JSON.stringify(normalizeComparableValue(right));
}

function isComparableRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatRepairPath(path: string[]) {
  return path.length ? path.join(".") : "registro";
}

function formatRepairValue(value: unknown) {
  const text = JSON.stringify(value);
  const display = text ?? String(value);
  return display.length > 120 ? `${display.slice(0, 117)}...` : display;
}

function findFirstRepairMismatch(actual: unknown, preview: unknown, path: string[] = []): string | null {
  if (JSON.stringify(actual) === JSON.stringify(preview)) return null;

  if (Array.isArray(actual) || Array.isArray(preview)) {
    if (!Array.isArray(actual) || !Array.isArray(preview)) {
      return `${formatRepairPath(path)} preview=${formatRepairValue(preview)} actual=${formatRepairValue(actual)}`;
    }
    const maxLength = Math.max(actual.length, preview.length);
    for (let index = 0; index < maxLength; index += 1) {
      const mismatch = findFirstRepairMismatch(actual[index], preview[index], [...path, String(index)]);
      if (mismatch) return mismatch;
    }
    return `${formatRepairPath(path)} preview=${formatRepairValue(preview)} actual=${formatRepairValue(actual)}`;
  }

  if (isComparableRecord(actual) && isComparableRecord(preview)) {
    const keys = Array.from(new Set([...Object.keys(actual), ...Object.keys(preview)])).sort();
    for (const key of keys) {
      const mismatch = findFirstRepairMismatch(actual[key], preview[key], [...path, key]);
      if (mismatch) return mismatch;
    }
  }

  return `${formatRepairPath(path)} preview=${formatRepairValue(preview)} actual=${formatRepairValue(actual)}`;
}

function getRepairMismatchDetail(actual: Record<string, any>, preview: Record<string, any> | null) {
  const mismatch = findFirstRepairMismatch(
    normalizeComparableValue(actual),
    normalizeComparableValue(preview),
  );
  return mismatch ? ` Diferencia: ${mismatch}.` : "";
}

function validateRepairOperationSnapshotIsFresh(
  operation: RepairOperation,
  snapshot: DocumentSnapshot<DocumentData>,
) {
  if (operation.op === "create") {
    if (snapshot.exists()) {
      throw new Error(
        `El plan ya no esta vigente: ${operation.collection}/${operation.recordId} ya existe. Regenera la auditoria antes de aplicar.`,
      );
    }
    return;
  }

  if (!snapshot.exists()) {
    throw new Error(
      `El plan ya no esta vigente: ${operation.collection}/${operation.recordId} ya no existe. Regenera la auditoria antes de aplicar.`,
    );
  }

  const current = { id: snapshot.id, ...snapshot.data() };
  if (!repairRecordsMatch(current, operation.before)) {
    throw new Error(
      `El plan ya no esta vigente: ${operation.collection}/${operation.recordId} cambio desde el preview. Regenera la auditoria antes de aplicar.${getRepairMismatchDetail(current, operation.before)}`,
    );
  }
}

async function validateRepairChunkIsFresh(
  transaction: FirestoreTransaction,
  operations: RepairOperation[],
) {
  for (const operation of operations) {
    const snapshot = await transaction.get(repairCollectionDoc(operation.collection, operation.recordId));
    validateRepairOperationSnapshotIsFresh(operation, snapshot);
  }
}

function applyRepairOperationToTransaction(
  transaction: FirestoreTransaction,
  operation: RepairOperation,
) {
  const ref = repairCollectionDoc(operation.collection, operation.recordId);
  if (operation.op === "create") {
    transaction.set(ref, stripDocumentId(operation.after ?? {}));
  } else if (operation.op === "update") {
    transaction.update(ref, operation.patch ?? stripDocumentId(operation.after ?? {}));
  } else {
    transaction.delete(ref);
  }
}

async function applyRepairPlan(plan: RepairPlan) {
  for (let i = 0; i < plan.operations.length; i += 450) {
    const operations = plan.operations.slice(i, i + 450);
    await runTransaction(db, async (transaction) => {
      await validateRepairChunkIsFresh(transaction, operations);
      operations.forEach((operation) => applyRepairOperationToTransaction(transaction, operation));
    });
  }
  return plan;
}

function isItemBudgetKey(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ITEM_BUDGET_PREFIX);
}

function getItemBudgetId(value: string | null | undefined) {
  if (!isItemBudgetKey(value)) return null;
  return value.slice(ITEM_BUDGET_PREFIX.length) || null;
}

async function fixRecurringBudgetTransactionLabels(transactions: Transaction[]): Promise<Transaction[]> {
  const candidates = transactions.filter((transaction) => {
    if (transaction.notes !== "Generado automáticamente desde presupuesto recurrente") return false;
    return isItemBudgetKey(transaction.name) || isItemBudgetKey(transaction.category);
  });

  if (!candidates.length) return transactions;

  const [itemsSnap, categoriesSnap] = await Promise.all([getDocs(itemsCol()), getDocs(categoriesCol())]);
  const items = snapToArray<Item>(itemsSnap);
  const categories = snapToArray<Category>(categoriesSnap);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const updates: Array<{ id: string; data: Record<string, any> }> = [];
  const fixedTransactions = transactions.map((transaction) => {
    const itemId =
      transaction.itemId ??
      getItemBudgetId(transaction.name) ??
      getItemBudgetId(transaction.category);

    if (!itemId) return transaction;

    const item = itemById.get(itemId);
    const category = item?.categoryId ? categoryById.get(item.categoryId) : null;
    if (!item?.name || !category?.name) return transaction;

    const needsFix =
      transaction.itemId !== itemId ||
      transaction.name !== item.name ||
      transaction.category !== category.name;

    if (!needsFix) return transaction;

    const data = {
      itemId,
      name: item.name,
      category: category.name,
    };
    updates.push({ id: transaction.id, data });
    return { ...transaction, ...data };
  });

  if (updates.length) {
    const batch = writeBatch(db);
    for (const update of updates) {
      batch.update(doc(db, "transactions", update.id), update.data);
    }
    await batch.commit();
  }

  return fixedTransactions;
}

// ════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ════════════════════════════════════════════════════════════════
export async function getTransactions() {
  const snap = await getDocs(query(transactionsCol(), orderBy("date", "desc")));
  const transactions = snapToArray<Transaction>(snap);
  return fixRecurringBudgetTransactionLabels(transactions);
}

export async function createTransaction(data: Record<string, any>) {
  const ref = await addDoc(transactionsCol(), data);
  return { id: ref.id, ...data };
}

export async function updateTransaction(id: string, data: Record<string, any>) {
  const ref = doc(db, "transactions", id);
  await updateDoc(ref, data);
  return { id, ...data };
}

export async function deleteTransaction(id: string) {
  await deleteDoc(doc(db, "transactions", id));
}

export async function bulkDeleteTransactions(ids: string[]) {
  const batch = writeBatch(db);
  for (const id of ids) {
    batch.delete(doc(db, "transactions", id));
  }
  await batch.commit();
  return { deleted: ids.length };
}

/** Batch-create multiple transactions (for CSV import) */
export async function bulkCreateTransactions(rows: Record<string, any>[]) {
  let imported = 0;
  // Firestore batches max 500 writes
  for (let i = 0; i < rows.length; i += 450) {
    const chunk = rows.slice(i, i + 450);
    const batch = writeBatch(db);
    for (const row of chunk) {
      const ref = doc(transactionsCol());
      batch.set(ref, row);
      imported++;
    }
    await batch.commit();
  }
  return { imported, total: rows.length };
}

// ════════════════════════════════════════════════════════════════
// CATEGORIES
// ════════════════════════════════════════════════════════════════
export async function getCategories() {
  const snap = await getDocs(categoriesCol());
  return snapToArray<any>(snap);
}

export async function createCategory(data: Record<string, any>) {
  const ref = await addDoc(categoriesCol(), data);
  return { id: ref.id, ...data };
}

export async function updateCategory(id: string, data: Record<string, any>) {
  const ref = doc(db, "categories", id);
  await updateDoc(ref, data);
  return { id, ...data };
}

export async function deleteCategory(id: string) {
  await deleteDoc(doc(db, "categories", id));
}

export async function mergeDuplicateCategories(primaryCategoryId: string, duplicateCategoryIds: string[]) {
  const [
    categoriesSnap,
    itemsSnap,
    transactionsSnap,
    budgetsSnap,
    commitmentTemplatesSnap,
    commitmentInstancesSnap,
    movementRulesSnap,
    importedMovementsSnap,
  ] = await Promise.all([
    getDocs(categoriesCol()),
    getDocs(itemsCol()),
    getDocs(transactionsCol()),
    getDocs(budgetsCol()),
    getDocs(commitmentTemplatesCol()),
    getDocs(commitmentInstancesCol()),
    getDocs(movementRulesCol()),
    getDocs(importedMovementsCol()),
  ]);
  const plan = buildMergeDuplicateCategoriesPlan(
    {
      categories: snapToArray<Category>(categoriesSnap),
      items: snapToArray<Item>(itemsSnap),
      transactions: snapToArray<Transaction>(transactionsSnap),
      budgets: snapToArray<Budget>(budgetsSnap),
      commitmentTemplates: snapToArray<CommitmentTemplate>(commitmentTemplatesSnap),
      commitmentInstances: snapToArray<CommitmentInstance>(commitmentInstancesSnap),
      movementRules: snapToArray<MovementRule>(movementRulesSnap),
      importedMovements: snapToArray<ImportedMovement>(importedMovementsSnap),
    },
    primaryCategoryId,
    duplicateCategoryIds,
  );

  await applyRepairPlan(plan);
  return plan.summary;
}

export async function repairBrokenReferences() {
  const [categoriesSnap, itemsSnap, transactionsSnap, budgetsSnap] = await Promise.all([
    getDocs(categoriesCol()),
    getDocs(itemsCol()),
    getDocs(transactionsCol()),
    getDocs(budgetsCol()),
  ]);
  const plan = buildBrokenReferencesPlan(
    {
      categories: snapToArray<Category>(categoriesSnap),
      items: snapToArray<Item>(itemsSnap),
      transactions: snapToArray<Transaction>(transactionsSnap),
      budgets: snapToArray<Budget>(budgetsSnap),
    },
    {
      createId: (collectionName, hint) => doc(collection(db, collectionName)).id,
    },
  );

  await applyRepairPlan(plan);
  return plan.summary;
}

// ════════════════════════════════════════════════════════════════
// ITEMS (subcategories)
// ════════════════════════════════════════════════════════════════
export async function getItems() {
  const snap = await getDocs(itemsCol());
  return snapToArray<any>(snap);
}

export async function createItem(data: Record<string, any>) {
  const ref = await addDoc(itemsCol(), data);
  return { id: ref.id, ...data };
}

export async function updateItem(id: string, data: Record<string, any>) {
  const ref = doc(db, "items", id);
  await updateDoc(ref, data);
  return { id, ...data };
}

export async function deleteItem(id: string) {
  await deleteDoc(doc(db, "items", id));
}

// ════════════════════════════════════════════════════════════════
// BUDGETS
// ════════════════════════════════════════════════════════════════
export async function getBudgets() {
  const snap = await getDocs(budgetsCol());
  return snapToArray<any>(snap);
}

export async function createBudget(data: Record<string, any>) {
  const ref = await addDoc(budgetsCol(), data);
  return { id: ref.id, ...data };
}

export async function updateBudget(id: string, data: Record<string, any>) {
  const ref = doc(db, "budgets", id);
  await updateDoc(ref, data);
  return { id, ...data };
}

export async function deleteBudget(id: string) {
  await deleteDoc(doc(db, "budgets", id));
}

export async function generateMonthlyRecurringTransactions(year: number, month: number, workspace: string) {
  const [budgetsSnap, transactionsSnap, itemsSnap, categoriesSnap] = await Promise.all([
    getDocs(budgetsCol()),
    getDocs(transactionsCol()),
    getDocs(itemsCol()),
    getDocs(categoriesCol()),
  ]);
  const budgets = snapToArray<any>(budgetsSnap);
  const transactions = snapToArray<any>(transactionsSnap);
  const items = snapToArray<any>(itemsSnap);
  const categories = snapToArray<any>(categoriesSnap);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const previousMonthDate = new Date(year, month - 2, 1);
  const previousYear = previousMonthDate.getFullYear();
  const previousMonth = previousMonthDate.getMonth() + 1;
  const previousMonthBudgets = budgets.filter((budget) => {
    const budgetWorkspace = budget.workspace ?? "business";
    return (
      budgetWorkspace === workspace &&
      !budget.isArchived &&
      budget.year === previousYear &&
      budget.month === previousMonth
    );
  });

  const recurringBudgets = previousMonthBudgets.filter((budget) => budget.isRecurring);
  const recurringBudgetByGroup = new Map<string, any>();
  for (const budget of recurringBudgets) {
    recurringBudgetByGroup.set(budget.categoryGroup, budget);
  }

  const childBudgetEntriesByCategory = new Map<
    string,
    Array<{ budget: any; item: any; category: any }>
  >();
  for (const [groupKey, budget] of Array.from(recurringBudgetByGroup.entries())) {
    const itemId = getItemBudgetId(groupKey);
    if (!itemId) continue;

    const item = itemById.get(itemId);
    const category = item?.categoryId ? categoryById.get(item.categoryId) : null;
    if (!item?.name || !category?.name) continue;

    const entries = childBudgetEntriesByCategory.get(category.name) ?? [];
    entries.push({ budget, item, category });
    childBudgetEntriesByCategory.set(category.name, entries);
  }
  for (const entries of Array.from(childBudgetEntriesByCategory.values())) {
    entries.sort(
      (
        left: { budget: any; item: any; category: any },
        right: { budget: any; item: any; category: any },
      ) => left.item.name.localeCompare(right.item.name),
    );
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const batch = writeBatch(db);
  const consumedSubcategoryBudgetGroups = new Set<string>();
  let created = 0;

  for (const budget of recurringBudgets) {
    const budgetItemId = getItemBudgetId(budget.categoryGroup);
    if (budgetItemId && consumedSubcategoryBudgetGroups.has(budget.categoryGroup)) {
      continue;
    }

    const budgetItem = budgetItemId ? itemById.get(budgetItemId) : null;
    const budgetCategory = budgetItem?.categoryId ? categoryById.get(budgetItem.categoryId) : null;
    const transactionName = budgetItem?.name ?? budget.categoryGroup;
    const transactionCategory = budgetCategory?.name ?? budget.categoryGroup;

    const childBudgetEntries = budgetItemId
      ? []
      : childBudgetEntriesByCategory.get(String(budget.categoryGroup)) ?? [];

    if (childBudgetEntries.length > 0) {
      const dueDay = Math.min(Math.max(Number(budget.dayOfMonth ?? 1), 1), daysInMonth);
      const date = `${monthPrefix}-${String(dueDay).padStart(2, "0")}`;

      for (const childEntry of childBudgetEntries) {
        consumedSubcategoryBudgetGroups.add(childEntry.budget.categoryGroup);

        const alreadyExists = transactions.some((transaction) => {
          const transactionWorkspace = transaction.workspace ?? "business";
          return (
            transactionWorkspace === workspace &&
            transaction.subtype === "planned" &&
            transaction.status === "pending" &&
            transaction.itemId === childEntry.item.id &&
            String(transaction.date ?? "").startsWith(monthPrefix)
          );
        });

        if (alreadyExists) continue;

        const ref = doc(transactionsCol());
        batch.set(ref, {
          name: childEntry.item.name,
          category: childEntry.category.name,
          amount: Number(childEntry.budget.amount) || 0,
          type: "expense",
          date,
          notes: "Generado automáticamente desde presupuesto recurrente",
          subtype: "planned",
          status: "pending",
          itemId: childEntry.item.id,
          workspace,
          movementType: "expense",
          paymentMethod: "bank_account",
          destinationWorkspace: null,
          destinationAccountId: null,
          creditCardName: null,
          installmentCount: null,
          accountId: null,
          importBatchId: null,
          importBatchLabel: null,
          importedAt: null,
        });
        created += 1;
      }

      continue;
    }

    const alreadyExists = transactions.some((transaction) => {
      const transactionWorkspace = transaction.workspace ?? "business";
      const matchesBudgetTarget = budgetItemId
        ? transaction.itemId === budgetItemId
        : transaction.category === transactionCategory;
      return (
        transactionWorkspace === workspace &&
        transaction.subtype === "planned" &&
        transaction.status === "pending" &&
        matchesBudgetTarget &&
        String(transaction.date ?? "").startsWith(monthPrefix)
      );
    });

    if (alreadyExists) continue;

    const dueDay = Math.min(Math.max(Number(budget.dayOfMonth ?? 1), 1), daysInMonth);
    const date = `${monthPrefix}-${String(dueDay).padStart(2, "0")}`;
    const ref = doc(transactionsCol());

    batch.set(ref, {
      name: transactionName,
      category: transactionCategory,
      amount: Number(budget.amount) || 0,
      type: "expense",
      date,
      notes: "Generado automáticamente desde presupuesto recurrente",
      subtype: "planned",
      status: "pending",
      itemId: budgetItemId,
      workspace,
      movementType: "expense",
      paymentMethod: "bank_account",
      destinationWorkspace: null,
      destinationAccountId: null,
      creditCardName: null,
      installmentCount: null,
      accountId: null,
      importBatchId: null,
      importBatchLabel: null,
      importedAt: null,
    });
    created += 1;
  }

  if (created > 0) {
    await batch.commit();
  }

  return { created };
}

// ════════════════════════════════════════════════════════════════
// OPENING BALANCES (saldo inicial mensual)
// ════════════════════════════════════════════════════════════════
export async function getOpeningBalances() {
  const snap = await getDocs(openingBalancesCol());
  return snapToArray<any>(snap);
}

export async function listOpeningBalances() {
  return getOpeningBalances();
}

export async function getOpeningBalance(monthKey: string) {
  const [yearPart, monthPart] = monthKey.split("-").map(Number);
  if (!Number.isInteger(yearPart) || !Number.isInteger(monthPart)) return null;

  const snap = await getDocs(
    query(
      openingBalancesCol(),
      where("year", "==", yearPart),
      where("month", "==", monthPart),
      limit(1),
    ),
  );

  return snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as any);
}

export async function createOpeningBalance(data: Record<string, any>) {
  const ref = await addDoc(openingBalancesCol(), data);
  return { id: ref.id, ...data };
}

export async function updateOpeningBalance(id: string, data: Record<string, any>) {
  const ref = doc(db, "openingBalances", id);
  await updateDoc(ref, data);
  return { id, ...data };
}

export async function setOpeningBalance(monthKey: string, amount: number) {
  const [yearPart, monthPart] = monthKey.split("-").map(Number);
  if (!Number.isInteger(yearPart) || !Number.isInteger(monthPart)) {
    throw new Error(`Invalid monthKey for opening balance: ${monthKey}`);
  }

  const existing = await getOpeningBalance(monthKey);
  const normalizedAmount = Number.isFinite(amount) ? amount : 0;

  if (existing) {
    return updateOpeningBalance(existing.id, { amount: normalizedAmount });
  }

  return createOpeningBalance({
    year: yearPart,
    month: monthPart,
    amount: normalizedAmount,
  });
}

// ════════════════════════════════════════════════════════════════
// CLIENT PAYMENTS
// ════════════════════════════════════════════════════════════════
export async function getClientPayments() {
  const snap = await getDocs(clientPaymentsCol());
  return snapToArray<any>(snap).sort((a, b) => {
    const left = `${b.paymentDate ?? b.dueDate ?? ""}`;
    const right = `${a.paymentDate ?? a.dueDate ?? ""}`;
    return left.localeCompare(right);
  });
}

export async function createClientPayment(data: Record<string, any>) {
  const ref = await addDoc(clientPaymentsCol(), data);
  return { id: ref.id, ...data };
}

export async function updateClientPayment(id: string, data: Record<string, any>) {
  const ref = doc(db, "clientPayments", id);
  await updateDoc(ref, data);
  return { id, ...data };
}

export async function deleteClientPayment(id: string) {
  const [paymentRef, linkedTransactionsSnap] = await Promise.all([
    Promise.resolve(doc(db, "clientPayments", id)),
    getDocs(query(transactionsCol(), where("sourceClientPaymentId", "==", id))),
  ]);

  const batch = writeBatch(db);
  batch.delete(paymentRef);
  linkedTransactionsSnap.docs.forEach((transactionDoc) => {
    batch.delete(transactionDoc.ref);
  });
  await batch.commit();
}

export async function migrateClientPaymentStatuses() {
  const snap = await getDocs(clientPaymentsCol());
  const legacyPayments = snapToArray<any>(snap).filter((payment) => {
    const normalizedStatus = String(payment.status ?? "").toLowerCase();
    return normalizedStatus === "paid" || normalizedStatus === "cobrado";
  });

  if (legacyPayments.length === 0) {
    return { updated: 0 };
  }

  for (let index = 0; index < legacyPayments.length; index += 450) {
    const chunk = legacyPayments.slice(index, index + 450);
    const batch = writeBatch(db);

    for (const payment of chunk) {
      batch.update(doc(db, "clientPayments", payment.id), {
        status: "invoiced",
      });
    }

    await batch.commit();
  }

  return { updated: legacyPayments.length };
}

function buildClientPaymentSettlementTransaction(
  payment: ClientPayment,
  accountId: string | null,
): Record<string, any> | null {
  const paymentDate =
    payment.paymentDate ??
    payment.expectedDate ??
    payment.dueDate ??
    payment.issueDate ??
    null;

  if (!paymentDate || !accountId) return null;

  return {
    name: payment.clientName,
    type: "income",
    subtype: "actual",
    status: "paid",
    amount: Number(payment.netAmount) || 0,
    category: "Ingresos Clientes",
    workspace: payment.workspace ?? "business",
    accountId,
    paymentMethod: "bank_account",
    date: paymentDate,
    sourceClientPaymentId: payment.id,
    movementType: "income",
    notes: null,
    itemId: null,
    destinationWorkspace: null,
    destinationAccountId: null,
    creditCardName: null,
    installmentCount: null,
  };
}

export async function syncClientPaymentSettlement(
  payment: ClientPayment,
  options?: { accountId?: string | null },
) {
  const linkedTransactionsSnap = await getDocs(
    query(transactionsCol(), where("sourceClientPaymentId", "==", payment.id)),
  );
  const linkedTransactions = snapToArray<Transaction>(linkedTransactionsSnap).sort((left, right) =>
    String(left.date ?? "").localeCompare(String(right.date ?? "")),
  );

  if (payment.status !== "paid") {
    if (!linkedTransactions.length) {
      return { created: 0, updated: 0, deleted: 0, skipped: 0 };
    }

    const batch = writeBatch(db);
    linkedTransactions.forEach((transaction) => {
      batch.delete(doc(db, "transactions", transaction.id));
    });
    await batch.commit();
    return { created: 0, updated: 0, deleted: linkedTransactions.length, skipped: 0 };
  }

  const targetAccountId = options?.accountId ?? linkedTransactions[0]?.accountId ?? null;
  const transactionData = buildClientPaymentSettlementTransaction(payment, targetAccountId);
  if (!transactionData) {
    return { created: 0, updated: 0, deleted: 0, skipped: 1 };
  }

  if (!linkedTransactions.length) {
    const ref = await addDoc(transactionsCol(), transactionData);
    return { created: 1, updated: 0, deleted: 0, skipped: 0, id: ref.id };
  }

  const [primaryTransaction, ...duplicates] = linkedTransactions;
  const batch = writeBatch(db);
  batch.update(doc(db, "transactions", primaryTransaction.id), transactionData);
  duplicates.forEach((transaction) => {
    batch.delete(doc(db, "transactions", transaction.id));
  });
  await batch.commit();
  return {
    created: 0,
    updated: 1,
    deleted: duplicates.length,
    skipped: 0,
    id: primaryTransaction.id,
  };
}

export async function regularizeClientPayments() {
  const [paymentsSnap, clientsSnap, transactionsSnap] = await Promise.all([
    getDocs(clientPaymentsCol()),
    getDocs(clientsCol()),
    getDocs(transactionsCol()),
  ]);

  const payments = snapToArray<ClientPayment>(paymentsSnap);
  const clients = snapToArray<Client>(clientsSnap);
  const transactions = snapToArray<Transaction>(transactionsSnap);

  const clientById = new Map(clients.map((client) => [client.id, client]));
  const clientsByName = new Map<string, Client[]>();
  const clientsByRut = new Map<string, Client[]>();
  const clientsByEmail = new Map<string, Client[]>();

  for (const client of clients) {
    const nameKey = normalizeText(client.name);
    if (nameKey) {
      clientsByName.set(nameKey, [...(clientsByName.get(nameKey) ?? []), client]);
    }

    const rutKey = normalizeText(client.rut);
    if (rutKey) {
      clientsByRut.set(rutKey, [...(clientsByRut.get(rutKey) ?? []), client]);
    }

    const emailKey = normalizeText(client.email);
    if (emailKey) {
      clientsByEmail.set(emailKey, [...(clientsByEmail.get(emailKey) ?? []), client]);
    }
  }

  const linkedTransactionsByPaymentId = transactions.reduce<Map<string, Transaction[]>>((acc, transaction) => {
    if (!transaction.sourceClientPaymentId) return acc;
    acc.set(transaction.sourceClientPaymentId, [...(acc.get(transaction.sourceClientPaymentId) ?? []), transaction]);
    return acc;
  }, new Map());

  const batch = writeBatch(db);
  let updatedPayments = 0;
  let linkedByIdentity = 0;
  let updatedSettlements = 0;
  let deletedSettlements = 0;
  let skippedPaidWithoutAccount = 0;

  for (const payment of payments) {
    const currentClient = payment.clientId ? clientById.get(payment.clientId) ?? null : null;
    const rutMatches = normalizeText(payment.rut) ? clientsByRut.get(normalizeText(payment.rut)) ?? [] : [];
    const emailMatches = normalizeText(payment.email) ? clientsByEmail.get(normalizeText(payment.email)) ?? [] : [];
    const nameMatches = normalizeText(payment.clientName)
      ? clientsByName.get(normalizeText(payment.clientName)) ?? []
      : [];

    const matchedClient =
      currentClient ??
      (rutMatches.length === 1 ? rutMatches[0] : null) ??
      (emailMatches.length === 1 ? emailMatches[0] : null) ??
      (nameMatches.length === 1 ? nameMatches[0] : null);

    const paymentPatch: Record<string, any> = {};
    if (matchedClient && payment.clientId !== matchedClient.id) {
      paymentPatch.clientId = matchedClient.id;
      linkedByIdentity += 1;
    }
    if (matchedClient && !normalizeText(payment.rut) && matchedClient.rut) {
      paymentPatch.rut = matchedClient.rut;
    }
    if (matchedClient && !normalizeText(payment.contactName) && matchedClient.contactName) {
      paymentPatch.contactName = matchedClient.contactName;
    }
    if (matchedClient && !normalizeText(payment.email) && matchedClient.email) {
      paymentPatch.email = matchedClient.email;
    }

    if (Object.keys(paymentPatch).length > 0) {
      batch.update(doc(db, "clientPayments", payment.id), paymentPatch);
      updatedPayments += 1;
    }

    const settlementTransactions = linkedTransactionsByPaymentId.get(payment.id) ?? [];

    if (payment.status !== "paid") {
      settlementTransactions.forEach((transaction) => {
        batch.delete(doc(db, "transactions", transaction.id));
        deletedSettlements += 1;
      });
      continue;
    }

    if (!settlementTransactions.length) {
      skippedPaidWithoutAccount += 1;
      continue;
    }

    const [primaryTransaction, ...duplicates] = settlementTransactions;
    const settlementData = buildClientPaymentSettlementTransaction(payment, primaryTransaction.accountId ?? null);
    if (!settlementData) {
      skippedPaidWithoutAccount += 1;
      continue;
    }

    const needsSettlementUpdate = Object.entries(settlementData).some(([key, value]) => primaryTransaction[key as keyof Transaction] !== value);
    if (needsSettlementUpdate) {
      batch.update(doc(db, "transactions", primaryTransaction.id), settlementData);
      updatedSettlements += 1;
    }
    duplicates.forEach((transaction) => {
      batch.delete(doc(db, "transactions", transaction.id));
      deletedSettlements += 1;
    });
  }

  if (updatedPayments || updatedSettlements || deletedSettlements) {
    await batch.commit();
  }

  return {
    updatedPayments,
    linkedByIdentity,
    updatedSettlements,
    deletedSettlements,
    skippedPaidWithoutAccount,
  };
}

// ════════════════════════════════════════════════════════════════
// CLIENTS
// ════════════════════════════════════════════════════════════════
export async function getClients() {
  const snap = await getDocs(clientsCol());
  return snapToArray<any>(snap).sort((a, b) => `${a.name ?? ""}`.localeCompare(`${b.name ?? ""}`));
}

export async function createClient(data: Record<string, any>) {
  const payload = {
    paymentRisk: "low",
    averageDaysLate: 0,
    workspace: "business",
    createdAt: new Date().toISOString().slice(0, 10),
    rut: null,
    contactName: null,
    email: null,
    accountManager: null,
    notes: null,
    ...data,
  };
  const ref = await addDoc(clientsCol(), payload);
  return { id: ref.id, ...payload };
}

export async function updateClient(id: string, data: Record<string, any>) {
  const ref = doc(db, "clients", id);
  await updateDoc(ref, data);
  return { id, ...data };
}

export async function deleteClient(id: string) {
  await deleteDoc(doc(db, "clients", id));
}

// ════════════════════════════════════════════════════════════════
// ACCOUNTS
// ════════════════════════════════════════════════════════════════
export async function getAccounts() {
  const snap = await getDocs(accountsCol());
  return snapToArray<any>(snap).sort((a, b) => `${a.name ?? ""}`.localeCompare(`${b.name ?? ""}`));
}

export async function createAccount(data: Record<string, any>) {
  const payload = {
    currency: "CLP",
    workspace: "business",
    isShared: false,
    notes: null,
    updatedAt: new Date().toISOString().slice(0, 10),
    ...data,
  };
  const ref = await addDoc(accountsCol(), payload);
  return { id: ref.id, ...payload };
}

export async function updateAccount(id: string, data: Record<string, any>) {
  const ref = doc(db, "accounts", id);
  await updateDoc(ref, data);
  return { id, ...data };
}

export async function deleteAccount(id: string) {
  await deleteDoc(doc(db, "accounts", id));
}

// ════════════════════════════════════════════════════════════════
// CREDIT CARD SETTINGS
// ════════════════════════════════════════════════════════════════
export async function getCreditCardSettings() {
  const snap = await getDocs(creditCardSettingsCol());
  return snapToArray<any>(snap).sort((a, b) => `${a.cardName ?? ""}`.localeCompare(`${b.cardName ?? ""}`));
}

export async function createCreditCardSetting(data: Record<string, any>) {
  const payload = {
    defaultPaymentAccountId: null,
    workspace: "family",
    isActive: true,
    ...data,
  };
  const ref = await addDoc(creditCardSettingsCol(), payload);
  return { id: ref.id, ...payload };
}

export async function updateCreditCardSetting(id: string, data: Record<string, any>) {
  const ref = doc(db, "credit_card_settings", id);
  await updateDoc(ref, data);
  return { id, ...data };
}

export async function deleteCreditCardSetting(id: string) {
  await deleteDoc(doc(db, "credit_card_settings", id));
}

// ════════════════════════════════════════════════════════════════
// COMMITMENT AUTOMATION
// ════════════════════════════════════════════════════════════════
function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

// ════════════════════════════════════════════════════════════════
// MONTHLY CLOSE SNAPSHOTS
// ════════════════════════════════════════════════════════════════
export async function getMonthlyCloseSnapshots() {
  const snap = await getDocs(monthlyCloseSnapshotsCol());
  return snapToArray<MonthlyCloseSnapshot>(snap).sort((left, right) =>
    right.monthKey.localeCompare(left.monthKey),
  );
}

export async function saveMonthlyCloseSnapshot(data: InsertMonthlyCloseSnapshot) {
  const ref = doc(db, "monthlyCloseSnapshots", data.monthKey);
  const existingSnapshot = await getDoc(ref);
  const existing = existingSnapshot.exists()
    ? existingSnapshot.data() as Partial<MonthlyCloseSnapshot>
    : null;
  const now = nowIso();
  const payload: Omit<MonthlyCloseSnapshot, "id"> = {
    monthKey: data.monthKey,
    year: data.year,
    month: data.month,
    status: "closed",
    closedAt: data.closedAt ?? existing?.closedAt ?? now,
    reopenedAt: null,
    notes: data.notes ?? null,
    summary: data.summary,
    checklist: data.checklist,
    rows: data.rows,
    createdAt: existing?.createdAt ?? data.createdAt ?? now,
    updatedAt: now,
  };

  await setDoc(ref, payload, { merge: true });
  return { id: ref.id, ...payload };
}

export async function reopenMonthlyCloseSnapshot(monthKey: string) {
  const ref = doc(db, "monthlyCloseSnapshots", monthKey);
  const now = nowIso();
  await updateDoc(ref, {
    status: "reopened",
    reopenedAt: now,
    updatedAt: now,
  });
  return { id: monthKey, status: "reopened", reopenedAt: now, updatedAt: now };
}

export async function getCommitmentTemplates() {
  const snap = await getDocs(commitmentTemplatesCol());
  return snapToArray<CommitmentTemplate>(snap).sort((a, b) => {
    const leftDay = Number(a.dayOfMonth) || 1;
    const rightDay = Number(b.dayOfMonth) || 1;
    if (leftDay !== rightDay) return leftDay - rightDay;
    return `${a.name ?? ""}`.localeCompare(`${b.name ?? ""}`, "es");
  });
}

export async function createCommitmentTemplate(data: Record<string, any>) {
  const now = nowIso();
  const payload = {
    amountMode: "fixed",
    workspace: "family",
    movementType: "expense",
    paymentMethod: "bank_account",
    accountId: null,
    destinationAccountId: null,
    creditCardName: null,
    frequency: "monthly",
    matchingKeywords: [],
    amountTolerance: 1000,
    dateToleranceDays: 5,
    sourceBudgetKey: null,
    isActive: true,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...data,
  };
  const ref = await addDoc(commitmentTemplatesCol(), payload);
  return { id: ref.id, ...payload };
}

export async function updateCommitmentTemplate(id: string, data: Record<string, any>) {
  const ref = doc(db, "commitmentTemplates", id);
  const payload = {
    ...data,
    updatedAt: nowIso(),
  };
  await updateDoc(ref, payload);
  return { id, ...payload };
}

export async function deleteCommitmentTemplate(id: string) {
  await deleteDoc(doc(db, "commitmentTemplates", id));
}

export async function getCommitmentInstances() {
  const snap = await getDocs(query(commitmentInstancesCol(), orderBy("dueDate", "asc")));
  return snapToArray<CommitmentInstance>(snap);
}

export async function updateCommitmentInstance(id: string, data: Record<string, any>) {
  const payload = {
    ...data,
    updatedAt: nowIso(),
  };
  await updateDoc(doc(db, "commitmentInstances", id), payload);
  return { id, ...payload };
}

export async function deleteCommitmentInstance(id: string) {
  await deleteDoc(doc(db, "commitmentInstances", id));
}

export async function generateCommitmentInstances(monthKey: string) {
  const [templatesSnap, instancesSnap] = await Promise.all([
    getDocs(commitmentTemplatesCol()),
    getDocs(query(commitmentInstancesCol(), where("monthKey", "==", monthKey))),
  ]);
  const templates = snapToArray<CommitmentTemplate>(templatesSnap);
  const existingInstances = snapToArray<CommitmentInstance>(instancesSnap);
  const missingInstances = buildMissingCommitmentInstances(templates, existingInstances, monthKey);

  for (let index = 0; index < missingInstances.length; index += 450) {
    const batch = writeBatch(db);
    for (const instance of missingInstances.slice(index, index + 450)) {
      const ref = doc(commitmentInstancesCol());
      batch.set(ref, instance);
    }
    await batch.commit();
  }

  return {
    created: missingInstances.length,
    skipped: templates.filter((template) => template.isActive !== false).length - missingInstances.length,
  };
}

export async function bootstrapCommitmentTemplatesFromRecurringBudgets() {
  const [budgetsSnap, templatesSnap, itemsSnap, categoriesSnap] = await Promise.all([
    getDocs(budgetsCol()),
    getDocs(commitmentTemplatesCol()),
    getDocs(itemsCol()),
    getDocs(categoriesCol()),
  ]);
  const budgets = snapToArray<any>(budgetsSnap);
  const templates = snapToArray<CommitmentTemplate>(templatesSnap);
  const items = snapToArray<Item>(itemsSnap);
  const categories = snapToArray<Category>(categoriesSnap);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const latestRecurringByKey = new Map<string, any>();
  for (const budget of budgets) {
    if (budget.isArchived) continue;
    if (!budget.isRecurring) continue;
    const workspace = budget.workspace ?? "business";
    const sourceBudgetKey = `${workspace}::${budget.categoryGroup}`;
    const current = latestRecurringByKey.get(sourceBudgetKey);
    if (
      !current ||
      budget.year > current.year ||
      (budget.year === current.year && budget.month > current.month)
    ) {
      latestRecurringByKey.set(sourceBudgetKey, budget);
    }
  }

  const templateBySourceKey = new Map(
    templates
      .filter((template) => Boolean(template.sourceBudgetKey))
      .map((template) => [template.sourceBudgetKey as string, template]),
  );
  const existingFallbackKeys = new Set(
    templates.map((template) =>
      `${template.workspace ?? "family"}::${normalizeText(template.name)}::${normalizeText(template.category)}`,
    ),
  );
  const now = nowIso();
  const templatesToUpdate: Array<{ id: string; data: Record<string, any> }> = [];
  const payloads = Array.from(latestRecurringByKey.entries())
    .map(([sourceBudgetKey, budget]) => {
      const itemId = getItemBudgetId(budget.categoryGroup);
      const item = itemId ? itemById.get(itemId) : null;
      const category = item?.categoryId ? categoryById.get(item.categoryId) : null;
      const name = item?.name ?? budget.categoryGroup;
      const categoryName = category?.name ?? budget.categoryGroup;
      const workspace = budget.workspace ?? "business";
      const syncedData = {
        name,
        category: categoryName,
        amount: Number(budget.amount) || 0,
        workspace,
        dayOfMonth: Math.max(1, Math.min(31, Number(budget.dayOfMonth ?? 5) || 5)),
        sourceBudgetKey,
        updatedAt: now,
      };
      const existingFromSource = templateBySourceKey.get(sourceBudgetKey);

      if (existingFromSource) {
        templatesToUpdate.push({
          id: existingFromSource.id,
          data: syncedData,
        });
        return null;
      }

      const fallbackKey = `${workspace}::${normalizeText(name)}::${normalizeText(categoryName)}`;

      if (existingFallbackKeys.has(fallbackKey)) return null;
      existingFallbackKeys.add(fallbackKey);

      return {
        ...syncedData,
        amountMode: "fixed",
        movementType: "expense",
        paymentMethod: "bank_account",
        accountId: null,
        destinationAccountId: null,
        creditCardName: null,
        frequency: "monthly",
        matchingKeywords: [name, categoryName].filter(Boolean),
        amountTolerance: 1000,
        dateToleranceDays: 5,
        isActive: true,
        notes: "Creado desde presupuesto recurrente.",
        createdAt: now,
      };
    })
    .filter((payload) => payload !== null);

  for (let index = 0; index < templatesToUpdate.length; index += 450) {
    const batch = writeBatch(db);
    for (const template of templatesToUpdate.slice(index, index + 450)) {
      batch.update(doc(db, "commitmentTemplates", template.id), template.data);
    }
    await batch.commit();
  }

  for (let index = 0; index < payloads.length; index += 450) {
    const batch = writeBatch(db);
    for (const payload of payloads.slice(index, index + 450)) {
      batch.set(doc(commitmentTemplatesCol()), payload);
    }
    await batch.commit();
  }

  return {
    created: payloads.length,
    updated: templatesToUpdate.length,
    scanned: latestRecurringByKey.size,
  };
}

export async function generateBudgetCommitmentsForMonth(monthKey: string) {
  const templateSync = await bootstrapCommitmentTemplatesFromRecurringBudgets();
  const instanceSync = await generateCommitmentInstances(monthKey);

  return {
    templatesCreated: templateSync.created,
    templatesUpdated: templateSync.updated,
    templatesScanned: templateSync.scanned,
    instancesCreated: instanceSync.created,
    instancesSkipped: instanceSync.skipped,
  };
}

export async function reconcileCommitmentInstances(monthKey: string) {
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-31`;
  const [templatesSnap, instancesSnap, transactionsSnap] = await Promise.all([
    getDocs(commitmentTemplatesCol()),
    getDocs(query(commitmentInstancesCol(), where("monthKey", "==", monthKey))),
    getDocs(query(transactionsCol(), where("date", ">=", monthStart), where("date", "<=", monthEnd))),
  ]);
  const templates = snapToArray<CommitmentTemplate>(templatesSnap);
  const instances = snapToArray<CommitmentInstance>(instancesSnap);
  const transactions = snapToArray<Transaction>(transactionsSnap);
  const matches = findCommitmentMatches(instances, templates, transactions);

  for (let index = 0; index < matches.length; index += 450) {
    const batch = writeBatch(db);
    for (const match of matches.slice(index, index + 450)) {
      batch.update(doc(db, "commitmentInstances", match.instance.id), {
        status: "paid",
        matchedTransactionId: match.transaction.id,
        matchedAt: nowIso(),
        paidAt: match.transaction.date || todayDate(),
        updatedAt: nowIso(),
        notes: match.instance.notes
          ? `${match.instance.notes}\nConciliado: ${match.reasons.join(", ")}`
          : `Conciliado: ${match.reasons.join(", ")}`,
      });
    }
    await batch.commit();
  }

  return {
    matched: matches.length,
  };
}

// ════════════════════════════════════════════════════════════════
// BANK IMPORT PIPELINE
// ════════════════════════════════════════════════════════════════
export async function getImportBatches() {
  const snap = await getDocs(query(importBatchesCol(), orderBy("createdAt", "desc"), limit(100)));
  return snapToArray<ImportBatch>(snap).sort((a, b) => {
    const newerDate = b.createdAt ?? "";
    const olderDate = a.createdAt ?? "";
    return newerDate.localeCompare(olderDate);
  });
}

export async function getImportedMovements(options: {
  batchId?: string | null;
  status?: string | null;
  limitCount?: number;
} = {}) {
  const maxRows = Math.max(1, Math.min(Number(options.limitCount ?? 750) || 750, 1500));
  const snap = options.batchId
    ? options.status
      ? await getDocs(query(
          importedMovementsCol(),
          where("batchId", "==", options.batchId),
          where("status", "==", options.status),
          limit(maxRows),
        ))
      : await getDocs(query(importedMovementsCol(), where("batchId", "==", options.batchId), limit(maxRows)))
    : options.status
      ? await getDocs(query(importedMovementsCol(), where("status", "==", options.status), limit(maxRows)))
      : await getDocs(query(importedMovementsCol(), limit(maxRows)));
  return snapToArray<ImportedMovement>(snap).sort((a, b) => {
    if (a.status !== b.status) {
      const order: Record<string, number> = {
        pending: 0,
        duplicate: 1,
        converted: 2,
        discarded: 3,
      };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    }
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return `${a.description ?? ""}`.localeCompare(`${b.description ?? ""}`, "es");
  });
}

export async function updateImportedMovement(id: string, data: Record<string, any>) {
  const payload = {
    ...data,
    updatedAt: nowIso(),
  };
  await updateDoc(doc(db, "importedMovements", id), payload);
  return { id, ...payload };
}

export async function discardImportedMovement(id: string) {
  return updateImportedMovement(id, {
    status: "discarded",
    discardReason: "manual",
    discardedAt: nowIso(),
  });
}

export async function rollbackImportBatch(batchId: string) {
  const batchRef = doc(db, "importBatches", batchId);
  const batchSnapshot = await getDoc(batchRef);
  if (!batchSnapshot.exists()) {
    throw new Error("Lote de importacion no encontrado.");
  }

  const convertedSnap = await getDocs(query(
    importedMovementsCol(),
    where("batchId", "==", batchId),
    where("status", "==", "converted"),
  ));
  const convertedRemaining = convertedSnap.size;
  const batchData = batchSnapshot.data() as ImportBatch;
  if (batchData.status === "closed") {
    return {
      batchId,
      discarded: 0,
      convertedRemaining,
      alreadyClosed: true,
    };
  }

  const movementsSnap = await getDocs(query(
    importedMovementsCol(),
    where("batchId", "==", batchId),
    where("status", "in", ["pending", "duplicate"]),
  ));
  const movements = snapToArray<ImportedMovement>(movementsSnap);
  const now = nowIso();
  const chunkSize = 450;

  // Conversion is transaction-protected; rollback is a chunked status update because this is a personal single-user flow.
  for (let index = 0; index < movements.length; index += chunkSize) {
    const batch = writeBatch(db);
    for (const movement of movements.slice(index, index + chunkSize)) {
      batch.update(doc(db, "importedMovements", movement.id), {
        status: "discarded",
        discardReason: "batch_rollback",
        discardedAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();
  }

  await updateDoc(batchRef, {
    status: "closed",
    closedAt: now,
    discardedOnRollback: movements.length,
    updatedAt: now,
  });

  return {
    batchId,
    discarded: movements.length,
    convertedRemaining,
    alreadyClosed: false,
  };
}

export async function deleteImportedMovement(id: string) {
  await deleteDoc(doc(db, "importedMovements", id));
}

export async function getMovementRules() {
  const snap = await getDocs(movementRulesCol());
  return snapToArray<MovementRule>(snap).sort((a, b) => {
    const priorityDiff = (Number(b.priority) || 0) - (Number(a.priority) || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return `${a.name ?? ""}`.localeCompare(`${b.name ?? ""}`, "es");
  });
}

export async function createMovementRule(data: Record<string, any>) {
  const now = nowIso();
  const payload = {
    keywords: [],
    workspace: "family",
    movementType: "expense",
    paymentMethod: "bank_account",
    accountId: null,
    creditCardName: null,
    amountDirection: "any",
    priority: 0,
    isActive: true,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...data,
  };
  const ref = await addDoc(movementRulesCol(), payload);
  return { id: ref.id, ...payload };
}

export async function updateMovementRule(id: string, data: Record<string, any>) {
  const payload = {
    ...data,
    updatedAt: nowIso(),
  };
  await updateDoc(doc(db, "movementRules", id), payload);
  return { id, ...payload };
}

export async function deleteMovementRule(id: string) {
  await deleteDoc(doc(db, "movementRules", id));
}

function dateInMonth(monthKey: string, day: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const safeDay = Math.min(Math.max(day, 1), daysInMonth);
  return `${monthKey}-${String(safeDay).padStart(2, "0")}`;
}

function accountMatchesBank(account: Account, bankHints: string[]) {
  const haystack = normalizeText(`${account.bank ?? ""} ${account.name ?? ""}`);
  return bankHints.some((hint) => haystack.includes(normalizeText(hint)));
}

function pickDemoAccount(
  accounts: Account[],
  workspace: string,
  bankHints: string[],
) {
  const cashAccounts = accounts.filter(
    (account) => account.type === "checking" || account.type === "savings",
  );
  return (
    cashAccounts.find((account) => account.workspace === workspace && accountMatchesBank(account, bankHints)) ??
    cashAccounts.find((account) => account.workspace === workspace) ??
    cashAccounts.find((account) => accountMatchesBank(account, bankHints)) ??
    null
  );
}

function findCreditCardName(accounts: Account[]) {
  const accountCard = accounts.find((account) => account.type === "credit_card");
  return accountCard ? `${accountCard.bank} ${accountCard.name}`.trim() : "Tarjeta demo Santander";
}

function getLastDayOfMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function buildDemoMovementInputs(
  batchId: string,
  accounts: Account[],
  monthKey: string,
  now: string,
): MovementSeedInput[] {
  const businessAccount = pickDemoAccount(accounts, "business", ["santander", "itau"]);
  const familyAccount = pickDemoAccount(accounts, "family", ["edwards", "santander"]);
  const itauAccount = pickDemoAccount(accounts, "business", ["itau"]);
  const demoItauAccount = itauAccount ?? businessAccount;
  const cardName = findCreditCardName(accounts);

  return [
    {
      batchId,
      source: "demo",
      sourceName: "Demo Santander Empresa",
      sourceType: "bank_account",
      bankName: businessAccount?.bank ?? "Santander",
      accountId: businessAccount?.id ?? null,
      date: dateInMonth(monthKey, 3),
      description: "Transferencia cliente Demo Retainer Junio",
      amount: 1850000,
      direction: "income",
      category: "Ingresos Clientes",
      workspace: "business",
      movementType: "income",
      paymentMethod: "bank_account",
      confidence: 88,
      isDemo: true,
      createdAt: now,
    },
    {
      batchId,
      source: "demo",
      sourceName: "Demo Santander Empresa",
      sourceType: "bank_account",
      bankName: businessAccount?.bank ?? "Santander",
      accountId: businessAccount?.id ?? null,
      date: dateInMonth(monthKey, 4),
      description: "Google Ads Chile facturacion",
      amount: 324000,
      direction: "expense",
      category: "Publicidad",
      workspace: "business",
      movementType: "expense",
      paymentMethod: "bank_account",
      confidence: 84,
      isDemo: true,
      createdAt: now,
    },
    {
      batchId,
      source: "demo",
      sourceName: "Demo Itau Empresa",
      sourceType: "bank_account",
      bankName: demoItauAccount?.bank ?? "Itau",
      accountId: demoItauAccount?.id ?? null,
      date: dateInMonth(monthKey, 5),
      description: "Arriendo oficina Octopus",
      amount: 720000,
      direction: "expense",
      category: "Arriendo",
      workspace: "business",
      movementType: "expense",
      paymentMethod: "bank_account",
      confidence: 80,
      isDemo: true,
      createdAt: now,
    },
    {
      batchId,
      source: "demo",
      sourceName: "Demo Edwards Familia",
      sourceType: "bank_account",
      bankName: familyAccount?.bank ?? "Banco Edwards",
      accountId: familyAccount?.id ?? null,
      date: dateInMonth(monthKey, 8),
      description: "Supermercado Jumbo Kennedy",
      amount: 118430,
      direction: "expense",
      category: "Comida",
      workspace: "family",
      movementType: "expense",
      paymentMethod: "bank_account",
      confidence: 86,
      isDemo: true,
      createdAt: now,
    },
    {
      batchId,
      source: "demo",
      sourceName: "Demo Edwards Familia",
      sourceType: "bank_account",
      bankName: familyAccount?.bank ?? "Banco Edwards",
      accountId: familyAccount?.id ?? null,
      date: dateInMonth(monthKey, 8),
      description: "Supermercado Jumbo Kennedy",
      amount: 118430,
      direction: "expense",
      category: "Comida",
      workspace: "family",
      movementType: "expense",
      paymentMethod: "bank_account",
      confidence: 86,
      notes: "Fila duplicada intencional para probar deduplicacion.",
      isDemo: true,
      createdAt: now,
    },
    {
      batchId,
      source: "demo",
      sourceName: "Demo Edwards Familia",
      sourceType: "bank_account",
      bankName: familyAccount?.bank ?? "Banco Edwards",
      accountId: familyAccount?.id ?? null,
      date: dateInMonth(monthKey, 9),
      description: "Colegio mensualidad demo",
      amount: 410000,
      direction: "expense",
      category: "Educacion",
      workspace: "family",
      movementType: "expense",
      paymentMethod: "bank_account",
      confidence: 74,
      isDemo: true,
      createdAt: now,
    },
    {
      batchId,
      source: "demo",
      sourceName: "Demo Tarjeta Santander",
      sourceType: "credit_card",
      bankName: "Santander",
      accountId: null,
      creditCardName: cardName,
      date: dateInMonth(monthKey, 10),
      description: "Uber Eats Las Condes",
      amount: 32890,
      direction: "expense",
      category: "Comida",
      workspace: "family",
      movementType: "expense",
      paymentMethod: "credit_card",
      confidence: 82,
      isDemo: true,
      createdAt: now,
    },
    {
      batchId,
      source: "demo",
      sourceName: "Demo Edwards Familia",
      sourceType: "bank_account",
      bankName: familyAccount?.bank ?? "Banco Edwards",
      accountId: familyAccount?.id ?? null,
      creditCardName: cardName,
      date: dateInMonth(monthKey, 12),
      description: "Pago tarjeta Santander pesos",
      amount: 450000,
      direction: "expense",
      category: "Pago tarjeta",
      workspace: "family",
      movementType: "credit_card_payment",
      paymentMethod: "bank_account",
      confidence: 90,
      isDemo: true,
      createdAt: now,
    },
    {
      batchId,
      source: "demo",
      sourceName: "Demo Edwards Familia",
      sourceType: "bank_account",
      bankName: familyAccount?.bank ?? "Banco Edwards",
      accountId: familyAccount?.id ?? null,
      date: dateInMonth(monthKey, 13),
      description: "Traspaso a cuenta empresa Octopus",
      amount: 300000,
      direction: "expense",
      category: "Transferencias",
      workspace: "family",
      movementType: "transfer",
      paymentMethod: "bank_account",
      destinationWorkspace: "business",
      destinationAccountId: businessAccount?.id ?? null,
      confidence: 78,
      isDemo: true,
      createdAt: now,
    },
    {
      batchId,
      source: "demo",
      sourceName: "Demo Itau Empresa",
      sourceType: "bank_account",
      bankName: demoItauAccount?.bank ?? "Itau",
      accountId: demoItauAccount?.id ?? null,
      date: dateInMonth(monthKey, 14),
      description: "Fintoc suscripcion demo",
      amount: 29900,
      direction: "expense",
      category: "Software",
      workspace: "business",
      movementType: "expense",
      paymentMethod: "bank_account",
      confidence: 76,
      isDemo: true,
      createdAt: now,
    },
  ];
}

function transactionKeysByMatch(transactions: Transaction[]) {
  const keys = new Map<string, string>();
  for (const transaction of transactions) {
    if ((transaction.status ?? "paid") === "cancelled") continue;
    const key = buildTransactionMatchKey({
      date: transaction.date,
      name: transaction.name,
      amount: Number(transaction.amount) || 0,
      movementType: transaction.movementType ?? (transaction.type === "income" ? "income" : "expense"),
      accountId: transaction.accountId ?? null,
      creditCardName: transaction.creditCardName ?? null,
    });
    keys.set(key, transaction.id);
  }
  return keys;
}

async function findExistingTransactionForPayload(payload: Omit<Transaction, "id">) {
  const snap = await getDocs(query(transactionsCol(), where("date", "==", payload.date)));
  return findMatchingTransactionForPayload(payload, snapToArray<Transaction>(snap));
}

async function markImportedMovementAsDuplicate(id: string, duplicateTransactionId: string) {
  const updatedAt = nowIso();
  await updateDoc(doc(db, "importedMovements", id), {
    status: "duplicate",
    duplicateTransactionId,
    updatedAt,
  });
}

export async function seedDemoImportedMovements() {
  const now = nowIso();
  const monthKey = getCurrentMonthKey();
  const batchRef = doc(importBatchesCol());
  const batchId = batchRef.id;
  const monthStart = `${monthKey}-01`;
  const monthEnd = `${monthKey}-31`;

  const [accountsSnap, transactionsSnap, movementsSnap, rulesSnap] = await Promise.all([
    getDocs(accountsCol()),
    getDocs(query(transactionsCol(), where("date", ">=", monthStart), where("date", "<=", monthEnd))),
    getDocs(query(importedMovementsCol(), where("createdAt", ">=", `${monthKey}-01`))),
    getDocs(movementRulesCol()),
  ]);
  const accounts = snapToArray<Account>(accountsSnap);
  const transactions = snapToArray<Transaction>(transactionsSnap);
  const existingMovements = snapToArray<ImportedMovement>(movementsSnap);
  const rules = snapToArray<MovementRule>(rulesSnap);
  const existingMovementByKey = new Map(
    existingMovements
      .filter((movement) => movement.status !== "discarded")
      .map((movement) => [movement.dedupeKey, movement.id]),
  );
  const existingTransactionByKey = transactionKeysByMatch(transactions);
  const seenInBatch = new Map<string, string>();

  const movements = buildDemoMovementInputs(batchId, accounts, monthKey, now).map((input) => {
    const base = buildImportedMovement(input);
    const tempMovement = { id: "", ...base } as ImportedMovement;
    const ruledMovement = applyMovementRule(
      tempMovement,
      findBestMovementRule(tempMovement, rules),
    );
    const transactionKey = buildTransactionMatchKey({
      date: ruledMovement.date,
      name: ruledMovement.suggestedName,
      amount: ruledMovement.amount,
      movementType: ruledMovement.suggestedMovementType,
      accountId: ruledMovement.accountId,
      creditCardName: ruledMovement.creditCardName,
    });
    const duplicateMovementId =
      existingMovementByKey.get(ruledMovement.dedupeKey) ??
      seenInBatch.get(ruledMovement.dedupeKey) ??
      null;
    const duplicateTransactionId = existingTransactionByKey.get(transactionKey) ?? null;
    const status = duplicateMovementId || duplicateTransactionId ? "duplicate" : ruledMovement.status;
    const movementId = doc(importedMovementsCol()).id;

    if (!seenInBatch.has(ruledMovement.dedupeKey)) {
      seenInBatch.set(ruledMovement.dedupeKey, movementId);
    }

    const { id: _unused, ...movementWithoutId } = ruledMovement;
    return {
      id: movementId,
      data: {
        ...movementWithoutId,
        duplicateMovementId,
        duplicateTransactionId,
        status,
        confidence: status === "duplicate" ? Math.min(99, ruledMovement.confidence + 5) : ruledMovement.confidence,
      } satisfies Omit<ImportedMovement, "id">,
    };
  });

  const totalIncome = movements
    .filter((movement) => movement.data.direction === "income")
    .reduce((sum, movement) => sum + movement.data.amount, 0);
  const totalExpense = movements
    .filter((movement) => movement.data.direction === "expense")
    .reduce((sum, movement) => sum + movement.data.amount, 0);
  const duplicateCount = movements.filter((movement) => movement.data.status === "duplicate").length;

  const batchPayload: Omit<ImportBatch, "id"> = {
    label: `Demo multicuenta ${monthKey}`,
    source: "demo",
    sourceName: "Cartola demo Santander, Edwards e Itau",
    sourceType: "bank_account",
    bankName: "Santander / Edwards / Itau",
    accountId: null,
    creditCardName: null,
    workspace: "shared",
    periodStart: dateInMonth(monthKey, 1),
    periodEnd: dateInMonth(monthKey, getLastDayOfMonth(monthKey)),
    rowCount: movements.length,
    totalIncome,
    totalExpense,
    duplicateCount,
    status: "reviewing",
    isDemo: true,
    notes: "Lote ficticio para probar revision, deduplicacion y conversion a transacciones.",
    createdAt: now,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  batch.set(batchRef, batchPayload);
  for (const movement of movements) {
    batch.set(doc(db, "importedMovements", movement.id), movement.data);
  }
  await batch.commit();

  return {
    batchId,
    created: movements.length,
    pending: movements.filter((movement) => movement.data.status === "pending").length,
    duplicates: duplicateCount,
  };
}

function getDateRangeFromRows(rows: Array<{ date: string }>) {
  const dates = rows
    .map((row) => row.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();

  return {
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
  };
}

export async function createImportedMovementBatch(input: CreateImportedMovementBatchInput) {
  const now = nowIso();
  const batchRef = doc(importBatchesCol());
  const batchId = batchRef.id;
  const source = input.source ?? "manual_file";
  const { start, end } = getDateRangeFromRows(input.movements);
  const periodStart = input.periodStart ?? start;
  const periodEnd = input.periodEnd ?? end;

  if (!start || !end) {
    throw new Error("La carga necesita al menos una fecha valida para deduplicar por lote.");
  }

  const transactionQuery =
    query(transactionsCol(), where("date", ">=", start), where("date", "<=", end));
  const existingMovementQuery =
    query(importedMovementsCol(), where("date", ">=", start), where("date", "<=", end));

  const [transactionsSnap, movementsSnap, rulesSnap] = await Promise.all([
    getDocs(transactionQuery),
    getDocs(existingMovementQuery),
    getDocs(movementRulesCol()),
  ]);
  const transactions = snapToArray<Transaction>(transactionsSnap);
  const existingMovements = snapToArray<ImportedMovement>(movementsSnap);
  const rules = snapToArray<MovementRule>(rulesSnap);
  const existingMovementByKey = new Map(
    existingMovements
      .filter((movement) => movement.status !== "discarded")
      .map((movement) => [movement.dedupeKey, movement.id]),
  );
  const existingTransactionByKey = transactionKeysByMatch(transactions);
  const seenInBatch = new Map<string, string>();

  const movements = input.movements.map((row) => {
    const base = buildImportedMovement({
      ...row,
      batchId,
      source,
      sourceName: row.sourceName ?? input.sourceName,
      sourceType: row.sourceType ?? input.sourceType,
      bankName: row.bankName ?? input.bankName ?? null,
      accountId: row.accountId ?? input.accountId ?? null,
      creditCardName: row.creditCardName ?? input.creditCardName ?? null,
      isDemo: input.isDemo ?? row.isDemo ?? false,
      createdAt: now,
    });
    const tempMovement = { id: "", ...base } as ImportedMovement;
    const ruledMovement = applyMovementRule(
      tempMovement,
      findBestMovementRule(tempMovement, rules),
    );
    const transactionKey = buildTransactionMatchKey({
      date: ruledMovement.date,
      name: ruledMovement.suggestedName,
      amount: ruledMovement.amount,
      movementType: ruledMovement.suggestedMovementType,
      accountId: ruledMovement.accountId,
      creditCardName: ruledMovement.creditCardName,
    });
    const duplicateMovementId =
      existingMovementByKey.get(ruledMovement.dedupeKey) ??
      seenInBatch.get(ruledMovement.dedupeKey) ??
      null;
    const duplicateTransactionId = existingTransactionByKey.get(transactionKey) ?? null;
    const status = duplicateMovementId || duplicateTransactionId ? "duplicate" : ruledMovement.status;
    const movementId = doc(importedMovementsCol()).id;

    if (!seenInBatch.has(ruledMovement.dedupeKey)) {
      seenInBatch.set(ruledMovement.dedupeKey, movementId);
    }

    const { id: _unused, ...movementWithoutId } = ruledMovement;
    return {
      id: movementId,
      data: {
        ...movementWithoutId,
        duplicateMovementId,
        duplicateTransactionId,
        status,
        confidence: status === "duplicate" ? Math.min(99, ruledMovement.confidence + 5) : ruledMovement.confidence,
      } satisfies Omit<ImportedMovement, "id">,
    };
  });

  const totalIncome = movements
    .filter((movement) => movement.data.direction === "income")
    .reduce((sum, movement) => sum + movement.data.amount, 0);
  const totalExpense = movements
    .filter((movement) => movement.data.direction === "expense")
    .reduce((sum, movement) => sum + movement.data.amount, 0);
  const duplicateCount = movements.filter((movement) => movement.data.status === "duplicate").length;

  const batchPayload: Omit<ImportBatch, "id"> = {
    label: input.label,
    source,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    bankName: input.bankName ?? null,
    accountId: input.accountId ?? null,
    creditCardName: input.creditCardName ?? null,
    workspace: input.workspace ?? "shared",
    periodStart,
    periodEnd,
    rowCount: movements.length,
    totalIncome,
    totalExpense,
    duplicateCount,
    status: "reviewing",
    isDemo: input.isDemo ?? false,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const chunkSize = 449;
  for (let index = 0; index < Math.max(movements.length, 1); index += chunkSize) {
    const batch = writeBatch(db);
    if (index === 0) {
      batch.set(batchRef, batchPayload);
    }
    for (const movement of movements.slice(index, index + chunkSize)) {
      batch.set(doc(db, "importedMovements", movement.id), movement.data);
    }
    await batch.commit();
  }

  return {
    batchId,
    created: movements.length,
    pending: movements.filter((movement) => movement.data.status === "pending").length,
    duplicates: duplicateCount,
  };
}

function getCategoryKey(categoryName: string, type: "income" | "expense", workspace: string) {
  return `${type}::${workspace}::${normalizeText(categoryName)}`;
}

async function getExistingCategoryKeys() {
  const snap = await getDocs(categoriesCol());
  return new Set(
    snapToArray<Category>(snap).map((category) =>
      getCategoryKey(
        category.name,
        category.type === "income" ? "income" : "expense",
        category.workspace ?? "business",
      ),
    ),
  );
}

async function ensureCategoryExists(
  categoryName: string,
  type: "income" | "expense",
  workspace: string,
  categoryKeys?: Set<string>,
) {
  const normalizedCategory = normalizeText(categoryName);
  if (!normalizedCategory) return;

  const existingKeys = categoryKeys ?? await getExistingCategoryKeys();
  const key = getCategoryKey(categoryName, type, workspace);
  if (existingKeys.has(key)) return;

  await addDoc(categoriesCol(), {
    name: categoryName,
    type,
    color: type === "income" ? "#10b981" : "#64748b",
    workspace,
  });
  existingKeys.add(key);
}

function assertCompleteTransfer(transactionPayload: Omit<Transaction, "id">) {
  if (transactionPayload.movementType !== "transfer") return;

  if (!transactionPayload.destinationWorkspace || !transactionPayload.destinationAccountId) {
    throw new Error("El traspaso necesita workspace y cuenta destino antes de convertirse.");
  }

  if (transactionPayload.accountId && transactionPayload.accountId === transactionPayload.destinationAccountId) {
    throw new Error("La cuenta origen y destino del traspaso no pueden ser la misma.");
  }
}

export async function convertImportedMovementToTransaction(
  id: string,
  override: ImportedMovementOverride = {},
  options: { forceDuplicate?: boolean; categoryKeys?: Set<string> } = {},
) {
  const movementRef = doc(db, "importedMovements", id);
  const movementSnapshot = await getDoc(movementRef);
  if (!movementSnapshot.exists()) {
    throw new Error("Movimiento importado no encontrado.");
  }

  const movement = { id: movementSnapshot.id, ...movementSnapshot.data() } as ImportedMovement;
  const canConvert = movement.status === "pending" || (options.forceDuplicate && movement.status === "duplicate");
  if (!canConvert) {
    throw new Error("Solo los movimientos pendientes o duplicados forzados se pueden convertir.");
  }

  const batchSnapshot = await getDoc(doc(db, "importBatches", movement.batchId));
  const batchLabel = batchSnapshot.exists()
    ? ((batchSnapshot.data() as Partial<ImportBatch>).label ?? movement.sourceName)
    : movement.sourceName;
  const transactionPayload = {
    ...buildTransactionFromImportedMovement(movement, override),
    importBatchLabel: batchLabel,
  };
  assertCompleteTransfer(transactionPayload);

  if (!options.forceDuplicate) {
    const duplicateTransaction = await findExistingTransactionForPayload(transactionPayload);
    if (duplicateTransaction) {
      await markImportedMovementAsDuplicate(id, duplicateTransaction.id);
      throw new Error(
        `Este movimiento coincide con una transaccion existente (${duplicateTransaction.name}). Quedo marcado como duplicado.`,
      );
    }
  }

  const categoryType = transactionPayload.movementType === "income" ? "income" : "expense";
  await ensureCategoryExists(
    transactionPayload.category,
    categoryType,
    transactionPayload.workspace ?? "business",
    options.categoryKeys,
  );

  return runTransaction(db, async (transaction) => {
    const freshMovementSnapshot = await transaction.get(movementRef);
    if (!freshMovementSnapshot.exists()) {
      throw new Error("Movimiento importado no encontrado.");
    }

    const freshMovement = { id: freshMovementSnapshot.id, ...freshMovementSnapshot.data() } as ImportedMovement;
    const freshCanConvert =
      freshMovement.status === "pending" ||
      (options.forceDuplicate && freshMovement.status === "duplicate");
    if (!freshCanConvert) {
      throw new Error("Solo los movimientos pendientes o duplicados forzados se pueden convertir.");
    }

    const freshBatchSnapshot = await transaction.get(doc(db, "importBatches", freshMovement.batchId));
    const freshBatchLabel = freshBatchSnapshot.exists()
      ? ((freshBatchSnapshot.data() as Partial<ImportBatch>).label ?? freshMovement.sourceName)
      : freshMovement.sourceName;
    const freshTransactionPayload = {
      ...buildTransactionFromImportedMovement(freshMovement, override),
      importBatchLabel: freshBatchLabel,
    };
    assertCompleteTransfer(freshTransactionPayload);

    const transactionRef = doc(transactionsCol());
    const convertedAt = nowIso();
    transaction.set(transactionRef, freshTransactionPayload);
    transaction.update(movementRef, {
      status: "converted",
      matchedTransactionId: transactionRef.id,
      convertedAt,
      updatedAt: convertedAt,
    });

    return {
      transactionId: transactionRef.id,
      transactionIds: [transactionRef.id],
      movementId: id,
    };
  });
}

export async function bulkConvertImportedMovements(ids: string[]) {
  let converted = 0;
  let skipped = 0;
  const failed: Array<{ id: string; error: string }> = [];
  const categoryKeys = await getExistingCategoryKeys();

  for (const id of ids) {
    try {
      await convertImportedMovementToTransaction(id, {}, { categoryKeys });
      converted += 1;
    } catch (error) {
      skipped += 1;
      failed.push({
        id,
        error: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }

  return { converted, skipped, failed };
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD PREFERENCES
// ════════════════════════════════════════════════════════════════
export async function getDashboardPreferences() {
  const snapshot = await getDoc(preferencesDoc());
  if (!snapshot.exists()) return null;
  return snapshot.data() as { cardOrder?: string[]; hiddenCards?: string[] };
}

export async function updateDashboardPreferences(data: {
  cardOrder: string[];
  hiddenCards: string[];
}) {
  await setDoc(preferencesDoc(), data, { merge: true });
  return data;
}
