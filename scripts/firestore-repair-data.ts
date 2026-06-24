import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  updateDoc,
  writeBatch,
} from "firebase/firestore/lite";
import type {
  Account,
  Budget,
  Category,
  Client,
  ClientPayment,
  CreditCardSetting,
  Item,
  OpeningBalance,
  Transaction,
} from "../shared/schema";

type CollectionName =
  | "transactions"
  | "categories"
  | "items"
  | "budgets"
  | "openingBalances"
  | "clientPayments"
  | "clients"
  | "accounts"
  | "credit_card_settings";

const COLLECTIONS: CollectionName[] = [
  "transactions",
  "categories",
  "items",
  "budgets",
  "openingBalances",
  "clientPayments",
  "clients",
  "accounts",
  "credit_card_settings",
];

const SYSTEM_CATEGORIES = new Set([
  "ingresos clientes",
  "iva por pagar",
  "cuota tarjeta",
  "pago tarjeta",
  "pago tarjeta de credito",
  "transferencia",
  "transferencias",
]);

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadLocalEnv(cwd: string) {
  loadEnvFile(path.join(cwd, ".env.local"));
  loadEnvFile(path.join(cwd, "client", ".env.local"));
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env.local or client/.env.local before running this repair.`);
  }
  return value;
}

function createFirestore() {
  const app = initializeApp({
    apiKey: requiredEnv("VITE_FIREBASE_API_KEY"),
    authDomain: requiredEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: requiredEnv("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: requiredEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requiredEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: requiredEnv("VITE_FIREBASE_APP_ID"),
  });

  return getFirestore(app);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function fetchCollection<T>(db: ReturnType<typeof getFirestore>, name: CollectionName) {
  const snapshot = await getDocs(collection(db, name));
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as T);
}

async function fetchAll(db: ReturnType<typeof getFirestore>) {
  const [
    transactions,
    categories,
    items,
    budgets,
    openingBalances,
    clientPayments,
    clients,
    accounts,
    creditCardSettings,
  ] = await Promise.all([
    fetchCollection<Transaction>(db, "transactions"),
    fetchCollection<Category>(db, "categories"),
    fetchCollection<Item>(db, "items"),
    fetchCollection<Budget>(db, "budgets"),
    fetchCollection<OpeningBalance>(db, "openingBalances"),
    fetchCollection<ClientPayment>(db, "clientPayments"),
    fetchCollection<Client>(db, "clients"),
    fetchCollection<Account>(db, "accounts"),
    fetchCollection<CreditCardSetting>(db, "credit_card_settings"),
  ]);

  return {
    transactions,
    categories,
    items,
    budgets,
    openingBalances,
    clientPayments,
    clients,
    accounts,
    credit_card_settings: creditCardSettings,
  };
}

function writeBackup(cwd: string, data: Awaited<ReturnType<typeof fetchAll>>) {
  const auditDir = path.join(cwd, "audits");
  fs.mkdirSync(auditDir, { recursive: true });
  const backupFile = path.join(auditDir, `firestore-pre-repair-${nowStamp()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
  return backupFile;
}

function categoryKey(category: Pick<Category, "name" | "type" | "workspace">) {
  return `${normalizeText(category.name)}::${category.type}::${category.workspace ?? "business"}`;
}

async function createMissingCategories(
  db: ReturnType<typeof getFirestore>,
  transactions: Transaction[],
  categories: Category[],
) {
  const existingKeys = new Set(categories.map(categoryKey));
  const missing = new Map<string, Pick<Category, "name" | "type" | "workspace">>();

  for (const transaction of transactions) {
    const status = transaction.status ?? "paid";
    if (status === "cancelled") continue;
    if (!transaction.category?.trim()) continue;

    const normalizedName = normalizeText(transaction.category);
    if (SYSTEM_CATEGORIES.has(normalizedName)) continue;

    const type = transaction.type === "income" ? "income" : "expense";
    const workspace = transaction.workspace ?? "business";
    const key = `${normalizedName}::${type}::${workspace}`;
    if (existingKeys.has(key) || missing.has(key)) continue;

    missing.set(key, {
      name: transaction.category.trim(),
      type,
      workspace,
    });
  }

  const rows = Array.from(missing.values());
  for (let index = 0; index < rows.length; index += 450) {
    const batch = writeBatch(db);
    for (const row of rows.slice(index, index + 450)) {
      const ref = doc(collection(db, "categories"));
      batch.set(ref, { ...row, color: null });
    }
    await batch.commit();
  }

  return rows.length;
}

async function cancelZeroAmountTransactions(
  db: ReturnType<typeof getFirestore>,
  transactions: Transaction[],
) {
  const candidates = transactions.filter((transaction) => {
    const amount = Number(transaction.amount);
    const status = transaction.status ?? "paid";
    return status !== "cancelled" && Number.isFinite(amount) && amount === 0;
  });

  for (const transaction of candidates) {
    const previousNotes = transaction.notes?.trim();
    await updateDoc(doc(db, "transactions", transaction.id), {
      status: "cancelled",
      notes: previousNotes
        ? `${previousNotes}\nAnulado por reparacion automatica: monto 0.`
        : "Anulado por reparacion automatica: monto 0.",
    });
  }

  return candidates.length;
}

async function main() {
  const cwd = process.cwd();
  loadLocalEnv(cwd);

  const db = createFirestore();
  const before = await fetchAll(db);
  const backupFile = writeBackup(cwd, before);

  const [createdCategories, cancelledZeroTransactions] = await Promise.all([
    createMissingCategories(db, before.transactions, before.categories),
    cancelZeroAmountTransactions(db, before.transactions),
  ]);

  console.log(`Backup previo: ${backupFile}`);
  console.log(`Categorias creadas: ${createdCategories}`);
  console.log(`Transacciones monto 0 anuladas: ${cancelledZeroTransactions}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
