/**
 * Firestore data layer — replaces Express API + MemStorage.
 * Uses Firebase modular SDK v9.
 */
import type { Category, Client, ClientPayment, Item, Transaction } from "@shared/schema";
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

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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
  const previousMonthDate = new Date(year, month - 2, 1);
  const previousYear = previousMonthDate.getFullYear();
  const previousMonth = previousMonthDate.getMonth() + 1;
  const previousMonthBudgets = budgets.filter((budget) => {
    const budgetWorkspace = budget.workspace ?? "business";
    return (
      budgetWorkspace === workspace &&
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
