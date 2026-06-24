import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
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
import {
  auditFinanceData,
  summarizeIssuesByArea,
  type AuditIssue,
} from "../client/src/domain/finance-audit";

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
    throw new Error(`Missing ${name}. Add it to .env.local or client/.env.local before running this audit.`);
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

async function fetchCollection<T>(db: ReturnType<typeof getFirestore>, name: CollectionName) {
  const snapshot = await getDocs(collection(db, name));
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as T);
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function severityLabel(severity: AuditIssue["severity"]) {
  if (severity === "critical") return "P0";
  if (severity === "high") return "P1";
  if (severity === "medium") return "P2";
  return "P3";
}

function renderMarkdown(result: ReturnType<typeof auditFinanceData>, backupFile: string) {
  const byArea = summarizeIssuesByArea(result.issues);
  const lines: string[] = [
    "# Auditoria de datos y reconciliacion - Octopus Finance",
    "",
    `Fecha: ${result.generatedAt}`,
    `Backup: ${backupFile}`,
    "",
    "## Conteos",
    "",
    ...Object.entries(result.counts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Metricas",
    "",
    `- Caja disponible total: ${result.metrics.availableCash.all}`,
    `- Caja disponible empresa: ${result.metrics.availableCash.business}`,
    `- Caja disponible familia: ${result.metrics.availableCash.family}`,
    `- Caja disponible compartida: ${result.metrics.availableCash.shared}`,
    `- Diferencia ledger vs saldos banco: ${result.metrics.accountLedgerDifference}`,
    `- Deuda tarjeta estimada: ${result.metrics.creditCardDebt}`,
    `- Ingreso cliente pagado neto: ${result.metrics.paidClientNet}`,
    `- Ingreso cliente no pagado neto: ${result.metrics.unpaidClientNet}`,
    "",
    "## Issues por area",
    "",
  ];

  for (const [area, summary] of Object.entries(byArea).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(
      `- ${area}: P0 ${summary.critical}, P1 ${summary.high}, P2 ${summary.medium}, P3 ${summary.low}`,
    );
  }

  lines.push("", "## Issues", "");

  if (!result.issues.length) {
    lines.push("No se encontraron issues con las reglas actuales.");
    return lines.join("\n");
  }

  for (const issue of result.issues) {
    lines.push(
      `### ${severityLabel(issue.severity)} · ${issue.area} · ${issue.title}`,
      "",
      `- Registro: ${issue.recordId ?? "n/a"}`,
      `- Detalle: ${issue.detail}`,
    );
    if (issue.recommendation) {
      lines.push(`- Recomendacion: ${issue.recommendation}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const cwd = process.cwd();
  loadLocalEnv(cwd);
  const db = createFirestore();

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

  const result = auditFinanceData({
    transactions,
    categories,
    items,
    budgets,
    openingBalances,
    clientPayments,
    clients,
    accounts,
    creditCardSettings,
  });

  const auditDir = path.join(cwd, "audits");
  fs.mkdirSync(auditDir, { recursive: true });
  const stamp = nowStamp();
  const backupFile = path.join(auditDir, `firestore-backup-${stamp}.json`);
  const reportFile = path.join(auditDir, `finance-data-audit-${stamp}.md`);

  const backupPayload: Record<CollectionName, unknown[]> = {
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

  fs.writeFileSync(backupFile, JSON.stringify(backupPayload, null, 2));
  fs.writeFileSync(reportFile, renderMarkdown(result, backupFile));

  const highOrWorse = result.issues.filter((issue) => issue.severity === "critical" || issue.severity === "high").length;
  console.log(`Backup: ${backupFile}`);
  console.log(`Reporte: ${reportFile}`);
  console.log(`Issues: ${result.issues.length} (${highOrWorse} P0/P1)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
