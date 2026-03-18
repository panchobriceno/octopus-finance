/**
 * Firestore data layer — replaces Express API + MemStorage.
 * Uses Firebase modular SDK v9.
 */
import {
  collection,
  doc,
  getDocs,
  addDoc,
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
