/**
 * Firestore data layer — replaces Express API + MemStorage.
 * Uses Firebase modular SDK v9.
 */
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
const preferencesDoc = () => doc(db, "preferences", "dashboard");

// ════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ════════════════════════════════════════════════════════════════
export async function getTransactions() {
  const snap = await getDocs(query(transactionsCol(), orderBy("date", "desc")));
  return snapToArray<any>(snap);
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
  const budgetsSnap = await getDocs(budgetsCol());
  const transactionsSnap = await getDocs(transactionsCol());
  const budgets = snapToArray<any>(budgetsSnap);
  const transactions = snapToArray<any>(transactionsSnap);

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
    const alreadyExists = transactions.some((transaction) => {
      const transactionWorkspace = transaction.workspace ?? "business";
      return (
        transactionWorkspace === workspace &&
        transaction.subtype === "planned" &&
        transaction.status === "pending" &&
        transaction.category === budget.categoryGroup &&
        String(transaction.date ?? "").startsWith(monthPrefix)
      );
    });

    if (alreadyExists) continue;

    const dueDay = Math.min(Math.max(Number(budget.dayOfMonth ?? 1), 1), daysInMonth);
    const date = `${monthPrefix}-${String(dueDay).padStart(2, "0")}`;
    const ref = doc(transactionsCol());

    batch.set(ref, {
      name: budget.categoryGroup,
      category: budget.categoryGroup,
      amount: Number(budget.amount) || 0,
      type: "expense",
      date,
      notes: "Generado automáticamente desde presupuesto recurrente",
      subtype: "planned",
      status: "pending",
      itemId: null,
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

export async function createOpeningBalance(data: Record<string, any>) {
  const ref = await addDoc(openingBalancesCol(), data);
  return { id: ref.id, ...data };
}

export async function updateOpeningBalance(id: string, data: Record<string, any>) {
  const ref = doc(db, "openingBalances", id);
  await updateDoc(ref, data);
  return { id, ...data };
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
