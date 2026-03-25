/**
 * Firestore data layer — replaces Express API + MemStorage.
 * Uses Firebase modular SDK v9.
 */
import type { Category, Item, Transaction } from "@shared/schema";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  where,
  limit,
  type QuerySnapshot,
  type DocumentData,
} from "firebase/firestore/lite";
import { db } from "./firebase";

// ── Helper: map Firestore snapshot to typed array ───────────────
function snapToArray<T>(snap: QuerySnapshot<DocumentData>): T[] {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
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
const preferencesDoc = () => doc(db, "preferences", "dashboard");
const ITEM_BUDGET_PREFIX = "item:";

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

  const candidateBudgets = budgets
    .filter((budget) => {
      const budgetWorkspace = budget.workspace ?? "business";
      if (budgetWorkspace !== workspace) return false;
      if (budget.year > year) return false;
      if (budget.year === year && budget.month > month) return false;
      return true;
    })
    .sort((left, right) => {
      if (left.categoryGroup !== right.categoryGroup) {
        return String(left.categoryGroup).localeCompare(String(right.categoryGroup));
      }
      if (left.year !== right.year) return right.year - left.year;
      return right.month - left.month;
    });

  const latestBudgetByGroup = new Map<string, any>();
  for (const budget of candidateBudgets) {
    if (!latestBudgetByGroup.has(budget.categoryGroup)) {
      latestBudgetByGroup.set(budget.categoryGroup, budget);
    }
  }

  const recurringBudgets = Array.from(latestBudgetByGroup.values()).filter((budget) => budget.isRecurring);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const batch = writeBatch(db);
  let created = 0;

  for (const budget of recurringBudgets) {
    const budgetItemId = getItemBudgetId(budget.categoryGroup);
    const budgetItem = budgetItemId ? itemById.get(budgetItemId) : null;
    const budgetCategory = budgetItem?.categoryId ? categoryById.get(budgetItem.categoryId) : null;
    const transactionName = budgetItem?.name ?? budget.categoryGroup;
    const transactionCategory = budgetCategory?.name ?? budget.categoryGroup;
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
  await deleteDoc(doc(db, "clientPayments", id));
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
