/**
 * Auditoria READ-ONLY de integridad de datos.
 *
 * No escribe en Firestore: solo collection/getDocs contra una sesion autenticada.
 * Ejecutar:
 *   npx tsx scripts/bank-bot/audit-datos-full.ts
 */
import fs from "node:fs";
import path from "node:path";
import { collection, getDocs } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";
import { isExecutedTransaction, normalizeTransaction } from "@/lib/finance";
import type {
  Account,
  Budget,
  Category,
  Client,
  ClientPayment,
  CommitmentInstance,
  CommitmentTemplate,
  CreditCardSetting,
  CreditCardStatement,
  ImportBatch,
  ImportedMovement,
  Item,
  MonthlyCloseSnapshot,
  MovementRule,
  OpeningBalance,
  Transaction,
} from "@shared/schema";

type Severity = "P0" | "P1" | "P2";

type Finding = {
  severity: Severity;
  check: string;
  count: number;
  examples: string[];
  details?: string[];
};

type Data = {
  accounts: Account[];
  budgets: Budget[];
  categories: Category[];
  clientPayments: ClientPayment[];
  clients: Client[];
  commitmentInstances: CommitmentInstance[];
  commitmentTemplates: CommitmentTemplate[];
  creditCardSettings: CreditCardSetting[];
  creditCardStatements: CreditCardStatement[];
  importBatches: ImportBatch[];
  importedMovements: ImportedMovement[];
  items: Item[];
  monthlyCloseSnapshots: MonthlyCloseSnapshot[];
  movementRules: MovementRule[];
  openingBalances: OpeningBalance[];
  transactions: Transaction[];
};

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), "client", ".env.local"));

const db = await getAuthedDb();

async function readCollection<T>(name: string): Promise<T[]> {
  const snapshot = await getDocs(collection(db, name));
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) })) as T[];
}

function norm(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function workspaceKey(value: unknown) {
  const normalized = norm(value);
  return normalized || "__shared__";
}

function categoryKey(name: unknown, type: unknown, workspace: unknown) {
  return `${norm(name)}::${norm(type || "expense")}::${workspaceKey(workspace)}`;
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function last4(value: unknown) {
  return digits(value).slice(-4);
}

function isBlank(value: unknown) {
  return value === null || value === undefined || String(value).trim() === "";
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isFiniteAmount(value: unknown) {
  return Number.isFinite(toNumber(value));
}

function isIsoDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isMonthKey(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function amountAllowsNonPositive(status: unknown) {
  return norm(status) === "cancelled" || norm(status) === "skipped" || norm(status) === "discarded";
}

function txTypeForCategory(tx: Transaction) {
  const normalized = normalizeTransaction(tx);
  return normalized.movementType === "income" ? "income" : "expense";
}

function itemIdFromItemRef(value: unknown) {
  const text = String(value ?? "");
  const match = text.match(/(?:^|::)item:([^:|/\s]+)/);
  return match?.[1] ?? null;
}

function ids(records: Array<{ id: string }>, limit = 10) {
  return records.slice(0, limit).map((record) => record.id);
}

function addFinding(findings: Finding[], severity: Severity, check: string, examples: string[], details?: string[]) {
  const uniqueExamples = Array.from(new Set(examples));
  findings.push({
    severity,
    check,
    count: uniqueExamples.length,
    examples: uniqueExamples.slice(0, 10),
    details: details?.slice(0, 10),
  });
}

function printFinding(finding: Finding) {
  if (finding.count === 0) {
    console.log(`  OK — ${finding.check}`);
    return;
  }
  console.log(`  ${finding.count} — ${finding.check}`);
  console.log(`     ejemplos: ${finding.examples.join(", ") || "—"}`);
  for (const detail of finding.details ?? []) {
    console.log(`     - ${detail}`);
  }
}

function accountLabel(account: Account | undefined) {
  return account ? `${account.name} (${account.type}, ${account.id})` : "—";
}

function categoryExists(
  categoryIndex: Set<string>,
  name: unknown,
  type: unknown,
  workspace: unknown,
) {
  const exact = categoryKey(name, type, workspace);
  const shared = categoryKey(name, type, null);
  return categoryIndex.has(exact) || categoryIndex.has(shared);
}

function collectionMeta(data: Data) {
  return {
    accounts: data.accounts.length,
    budgets: data.budgets.length,
    categories: data.categories.length,
    clientPayments: data.clientPayments.length,
    clients: data.clients.length,
    commitmentInstances: data.commitmentInstances.length,
    commitmentTemplates: data.commitmentTemplates.length,
    creditCardSettings: data.creditCardSettings.length,
    creditCardStatements: data.creditCardStatements.length,
    importBatches: data.importBatches.length,
    importedMovements: data.importedMovements.length,
    items: data.items.length,
    monthlyCloseSnapshots: data.monthlyCloseSnapshots.length,
    movementRules: data.movementRules.length,
    openingBalances: data.openingBalances.length,
    transactions: data.transactions.length,
  };
}

const data: Data = {
  accounts: await readCollection<Account>("accounts"),
  budgets: await readCollection<Budget>("budgets"),
  categories: await readCollection<Category>("categories"),
  clientPayments: await readCollection<ClientPayment>("clientPayments"),
  clients: await readCollection<Client>("clients"),
  commitmentInstances: await readCollection<CommitmentInstance>("commitmentInstances"),
  commitmentTemplates: await readCollection<CommitmentTemplate>("commitmentTemplates"),
  creditCardSettings: await readCollection<CreditCardSetting>("creditCardSettings"),
  creditCardStatements: await readCollection<CreditCardStatement>("creditCardStatements"),
  importBatches: await readCollection<ImportBatch>("importBatches"),
  importedMovements: await readCollection<ImportedMovement>("importedMovements"),
  items: await readCollection<Item>("items"),
  monthlyCloseSnapshots: await readCollection<MonthlyCloseSnapshot>("monthlyCloseSnapshots"),
  movementRules: await readCollection<MovementRule>("movementRules"),
  openingBalances: await readCollection<OpeningBalance>("openingBalances"),
  transactions: await readCollection<Transaction>("transactions"),
};

const accountsById = new Map(data.accounts.map((account) => [account.id, account]));
const bankAccountIds = new Set(
  data.accounts
    .filter((account) => ["checking", "savings"].includes(account.type))
    .map((account) => account.id),
);
const creditCardAccountIds = new Set(
  data.accounts.filter((account) => account.type === "credit_card").map((account) => account.id),
);
const categoriesByKey = new Set(
  data.categories.map((category) => categoryKey(category.name, category.type, category.workspace)),
);
const itemsById = new Map(data.items.map((item) => [item.id, item]));
const clientsById = new Map(data.clients.map((client) => [client.id, client]));
const templatesById = new Map(data.commitmentTemplates.map((template) => [template.id, template]));
const transactionsById = new Map(data.transactions.map((transaction) => [transaction.id, transaction]));
const importBatchesById = new Map(data.importBatches.map((batch) => [batch.id, batch]));
const creditCardsByLast4 = new Map<string, Account[]>();
for (const account of data.accounts.filter((candidate) => candidate.type === "credit_card")) {
  const key = last4(account.accountNumber);
  if (!key) continue;
  creditCardsByLast4.set(key, [...(creditCardsByLast4.get(key) ?? []), account]);
}

const findings: Finding[] = [];

// P0 — Categorias duplicadas por name+type+workspace normalizado.
{
  const groups = new Map<string, Category[]>();
  for (const category of data.categories) {
    const key = categoryKey(category.name, category.type, category.workspace);
    groups.set(key, [...(groups.get(key) ?? []), category]);
  }
  const itemCountsByCategory = new Map<string, number>();
  for (const item of data.items) {
    if (!item.categoryId) continue;
    itemCountsByCategory.set(item.categoryId, (itemCountsByCategory.get(item.categoryId) ?? 0) + 1);
  }
  const duplicateGroups = Array.from(groups.values()).filter((group) => group.length > 1);
  addFinding(
    findings,
    "P0",
    "Categorias duplicadas por (name + type + workspace) normalizado",
    duplicateGroups.flatMap((group) => group.map((category) => category.id)),
    duplicateGroups.map((group) => {
      const label = `${group[0]?.name ?? "?"} / ${group[0]?.type ?? "?"} / ${group[0]?.workspace ?? "shared"}`;
      const withItems = group
        .map((category) => `${category.id}:${itemCountsByCategory.get(category.id) ?? 0}`)
        .join(", ");
      const empty = group.filter((category) => !itemCountsByCategory.get(category.id)).map((category) => category.id);
      return `${label} => items por id [${withItems}], vacias [${empty.join(", ") || "—"}]`;
    }),
  );
}

// P0 — FKs a cuentas inexistentes o de tipo incorrecto.
{
  const bad: string[] = [];
  const details: string[] = [];
  const push = (id: string, detail: string) => {
    bad.push(id);
    details.push(detail);
  };
  for (const tx of data.transactions) {
    if (tx.accountId && !accountsById.has(tx.accountId)) push(tx.id, `transactions.accountId ${tx.id} -> ${tx.accountId} inexistente`);
    if (tx.destinationAccountId && !accountsById.has(tx.destinationAccountId)) push(tx.id, `transactions.destinationAccountId ${tx.id} -> ${tx.destinationAccountId} inexistente`);
    if (tx.cardAccountId && !creditCardAccountIds.has(tx.cardAccountId)) push(tx.id, `transactions.cardAccountId ${tx.id} -> ${tx.cardAccountId} no existe/no es credit_card`);
  }
  for (const setting of data.creditCardSettings) {
    if (!setting.defaultPaymentAccountId) continue;
    if (!bankAccountIds.has(setting.defaultPaymentAccountId)) {
      push(setting.id, `creditCardSettings.defaultPaymentAccountId ${setting.id} -> ${setting.defaultPaymentAccountId} no existe/no es checking/savings`);
    }
  }
  for (const movement of data.importedMovements) {
    if (movement.suggestedSourceAccountId && !accountsById.has(movement.suggestedSourceAccountId)) {
      push(movement.id, `importedMovements.suggestedSourceAccountId ${movement.id} -> ${movement.suggestedSourceAccountId} inexistente`);
    }
    if (movement.suggestedDestinationAccountId && !accountsById.has(movement.suggestedDestinationAccountId)) {
      push(movement.id, `importedMovements.suggestedDestinationAccountId ${movement.id} -> ${movement.suggestedDestinationAccountId} inexistente`);
    }
  }
  addFinding(findings, "P0", "FKs a cuentas inexistentes o de tipo incorrecto", bad, details);
}

// P0 — Invariantes por movimiento.
{
  const bad: string[] = [];
  const details: string[] = [];
  const push = (tx: Transaction, detail: string) => {
    bad.push(tx.id);
    details.push(`${tx.id}: ${detail}`);
  };
  for (const tx of data.transactions) {
    const normalized = normalizeTransaction(tx);
    const executed = isExecutedTransaction(tx);
    const active = normalized.status !== "cancelled";
    if (!active) continue;

    if (normalized.movementType === "transfer") {
      if (!normalized.accountId || !normalized.destinationAccountId) push(tx, "transfer sin accountId o destinationAccountId");
      if (normalized.accountId && normalized.destinationAccountId && normalized.accountId === normalized.destinationAccountId) {
        push(tx, "transfer con origen == destino");
      }
    }

    if (normalized.movementType === "credit_card_payment") {
      if (!normalized.accountId || !normalized.cardAccountId) push(tx, "credit_card_payment sin accountId pagador o cardAccountId");
    }

    if (normalized.movementType === "expense" && normalized.paymentMethod === "credit_card" && !normalized.cardAccountId) {
      push(tx, "gasto con credit_card sin cardAccountId");
    }

    if (
      executed &&
      normalized.paymentMethod === "bank_account" &&
      normalized.movementType !== "transfer" &&
      !normalized.accountId
    ) {
      push(tx, "movimiento bancario ejecutado sin accountId");
    }
  }
  addFinding(findings, "P0", "Invariantes de movimientos", bad, details);
}

// P1 — Referencias a categoria por nombre que no existan.
{
  const bad: string[] = [];
  const details: string[] = [];
  const push = (id: string, detail: string) => {
    bad.push(id);
    details.push(detail);
  };
  for (const tx of data.transactions) {
    if (!tx.category) continue;
    if (!categoryExists(categoriesByKey, tx.category, txTypeForCategory(tx), tx.workspace)) {
      push(tx.id, `transaction ${tx.id}: "${tx.category}" (${txTypeForCategory(tx)}, ${tx.workspace ?? "business"})`);
    }
  }
  for (const rule of data.movementRules) {
    if (!rule.category) continue;
    const type = rule.movementType === "income" ? "income" : "expense";
    if (!categoryExists(categoriesByKey, rule.category, type, rule.workspace)) {
      push(rule.id, `movementRule ${rule.id}: "${rule.category}" (${type}, ${rule.workspace})`);
    }
  }
  for (const template of data.commitmentTemplates) {
    if (!template.category) continue;
    const type = template.movementType === "income" ? "income" : "expense";
    if (!categoryExists(categoriesByKey, template.category, type, template.workspace)) {
      push(template.id, `commitmentTemplate ${template.id}: "${template.category}" (${type}, ${template.workspace})`);
    }
  }
  for (const instance of data.commitmentInstances) {
    if (!instance.category) continue;
    const type = instance.movementType === "income" ? "income" : "expense";
    if (!categoryExists(categoriesByKey, instance.category, type, instance.workspace)) {
      push(instance.id, `commitmentInstance ${instance.id}: "${instance.category}" (${type}, ${instance.workspace})`);
    }
  }
  for (const movement of data.importedMovements) {
    if (!movement.suggestedCategory) continue;
    const type = movement.suggestedMovementType === "income" ? "income" : "expense";
    if (!categoryExists(categoriesByKey, movement.suggestedCategory, type, movement.suggestedWorkspace)) {
      push(movement.id, `importedMovement ${movement.id}: "${movement.suggestedCategory}" (${type}, ${movement.suggestedWorkspace})`);
    }
  }
  addFinding(findings, "P1", "Referencias por nombre a categorias inexistentes", bad, details);
}

// P1 — itemId huerfano.
{
  const bad: string[] = [];
  const details: string[] = [];
  for (const tx of data.transactions) {
    if (tx.itemId && !itemsById.has(tx.itemId)) {
      bad.push(tx.id);
      details.push(`transaction ${tx.id}: itemId ${tx.itemId} inexistente`);
    }
  }
  for (const template of data.commitmentTemplates as Array<CommitmentTemplate & { itemId?: string | null }>) {
    if (template.itemId && !itemsById.has(template.itemId)) {
      bad.push(template.id);
      details.push(`commitmentTemplate ${template.id}: itemId ${template.itemId} inexistente`);
    }
  }
  for (const instance of data.commitmentInstances as Array<CommitmentInstance & { itemId?: string | null }>) {
    if (instance.itemId && !itemsById.has(instance.itemId)) {
      bad.push(instance.id);
      details.push(`commitmentInstance ${instance.id}: itemId ${instance.itemId} inexistente`);
    }
  }
  addFinding(findings, "P1", "itemId huerfano en transactions/commitments", bad, details);
}

// P1 — item:<id> huerfano en budgets y commitmentTemplates.sourceBudgetKey.
{
  const bad: string[] = [];
  const details: string[] = [];
  for (const budget of data.budgets) {
    const itemId = itemIdFromItemRef(budget.categoryGroup);
    if (itemId && !itemsById.has(itemId)) {
      bad.push(budget.id);
      details.push(`budget ${budget.id}: categoryGroup ${budget.categoryGroup}`);
    }
  }
  for (const template of data.commitmentTemplates) {
    const itemId = itemIdFromItemRef(template.sourceBudgetKey);
    if (itemId && !itemsById.has(itemId)) {
      bad.push(template.id);
      details.push(`commitmentTemplate ${template.id}: sourceBudgetKey ${template.sourceBudgetKey}`);
    }
  }
  addFinding(findings, "P1", "Referencias item:<id> huerfanas en budgets/sourceBudgetKey", bad, details);
}

// P1 — commitmentInstances.templateId y paid matchedTransactionId.
{
  const bad: string[] = [];
  const details: string[] = [];
  for (const instance of data.commitmentInstances) {
    if (!templatesById.has(instance.templateId)) {
      bad.push(instance.id);
      details.push(`commitmentInstance ${instance.id}: templateId ${instance.templateId} inexistente`);
    }
    if (instance.status === "paid" && instance.matchedTransactionId && !transactionsById.has(instance.matchedTransactionId)) {
      bad.push(instance.id);
      details.push(`commitmentInstance ${instance.id}: matchedTransactionId ${instance.matchedTransactionId} inexistente`);
    }
  }
  addFinding(findings, "P1", "commitmentInstances con template/matchedTransaction invalido", bad, details);
}

// P1 — clientPayments.
{
  const bad: string[] = [];
  const details: string[] = [];
  for (const payment of data.clientPayments) {
    const net = toNumber(payment.netAmount);
    const vat = toNumber(payment.vatAmount);
    const total = toNumber(payment.totalAmount);
    if (!Number.isFinite(net) || !Number.isFinite(vat) || !Number.isFinite(total) || Math.abs(net + vat - total) > 1) {
      bad.push(payment.id);
      details.push(`clientPayment ${payment.id}: net(${payment.netAmount}) + vat(${payment.vatAmount}) != total(${payment.totalAmount})`);
    }
    if (payment.status === "paid" && !payment.paymentDate) {
      bad.push(payment.id);
      details.push(`clientPayment ${payment.id}: status paid sin paymentDate`);
    }
    if (payment.clientId && !clientsById.has(payment.clientId)) {
      bad.push(payment.id);
      details.push(`clientPayment ${payment.id}: clientId ${payment.clientId} inexistente`);
    }
  }
  addFinding(findings, "P1", "clientPayments con montos/status/clientId inconsistentes", bad, details);
}

// P1 — importedMovements.
{
  const bad: string[] = [];
  const details: string[] = [];
  for (const movement of data.importedMovements) {
    if (!importBatchesById.has(movement.batchId)) {
      bad.push(movement.id);
      details.push(`importedMovement ${movement.id}: batchId ${movement.batchId} inexistente`);
    }
    if (movement.matchedTransactionId && !transactionsById.has(movement.matchedTransactionId)) {
      bad.push(movement.id);
      details.push(`importedMovement ${movement.id}: matchedTransactionId ${movement.matchedTransactionId} inexistente`);
    }
    if (movement.duplicateTransactionId && !transactionsById.has(movement.duplicateTransactionId)) {
      bad.push(movement.id);
      details.push(`importedMovement ${movement.id}: duplicateTransactionId ${movement.duplicateTransactionId} inexistente`);
    }
  }
  addFinding(findings, "P1", "importedMovements con batch/matched/duplicate invalido", bad, details);
}

// P2 — Fechas ISO y monthKeys.
{
  const bad: string[] = [];
  const details: string[] = [];
  const checkDate = (id: string, label: string, value: unknown) => {
    if (!isBlank(value) && !isIsoDate(value)) {
      bad.push(id);
      details.push(`${label} ${id}: fecha invalida ${String(value)}`);
    }
  };
  const checkMonth = (id: string, label: string, value: unknown) => {
    if (!isBlank(value) && !isMonthKey(value)) {
      bad.push(id);
      details.push(`${label} ${id}: monthKey invalido ${String(value)}`);
    }
  };
  for (const tx of data.transactions) checkDate(tx.id, "transaction.date", tx.date);
  for (const payment of data.clientPayments) {
    checkDate(payment.id, "clientPayment.issueDate", payment.issueDate);
    checkDate(payment.id, "clientPayment.dueDate", payment.dueDate);
    checkDate(payment.id, "clientPayment.expectedDate", payment.expectedDate);
    checkDate(payment.id, "clientPayment.paymentDate", payment.paymentDate);
    checkMonth(payment.id, "clientPayment.serviceMonth", payment.serviceMonth);
  }
  for (const instance of data.commitmentInstances) {
    checkMonth(instance.id, "commitmentInstance.monthKey", instance.monthKey);
    checkDate(instance.id, "commitmentInstance.dueDate", instance.dueDate);
    checkDate(instance.id, "commitmentInstance.paidAt", instance.paidAt);
  }
  for (const statement of data.creditCardStatements) {
    checkMonth(statement.id, "creditCardStatement.statementMonthKey", statement.statementMonthKey);
    checkMonth(statement.id, "creditCardStatement.paymentMonthKey", statement.paymentMonthKey);
    checkDate(statement.id, "creditCardStatement.periodStart", statement.periodStart);
    checkDate(statement.id, "creditCardStatement.periodEnd", statement.periodEnd);
    checkDate(statement.id, "creditCardStatement.pagarHasta", statement.pagarHasta);
  }
  for (const batch of data.importBatches) {
    checkDate(batch.id, "importBatch.periodStart", batch.periodStart);
    checkDate(batch.id, "importBatch.periodEnd", batch.periodEnd);
  }
  for (const movement of data.importedMovements) checkDate(movement.id, "importedMovement.date", movement.date);
  for (const close of data.monthlyCloseSnapshots) checkMonth(close.id, "monthlyCloseSnapshot.monthKey", close.monthKey);
  addFinding(findings, "P2", "Fechas ISO/monthKey invalidos", bad, details);
}

// P2 — Montos finitos y no positivos.
{
  const bad: string[] = [];
  const details: string[] = [];
  const checkAmount = (id: string, label: string, value: unknown, status?: unknown) => {
    if (!isFiniteAmount(value)) {
      bad.push(id);
      details.push(`${label} ${id}: monto no finito ${String(value)}`);
      return;
    }
    if ((Number(value) <= 0) && !amountAllowsNonPositive(status)) {
      bad.push(id);
      details.push(`${label} ${id}: monto <= 0 (${String(value)}) con status ${String(status ?? "—")}`);
    }
  };
  for (const tx of data.transactions) checkAmount(tx.id, "transaction.amount", tx.amount, tx.status);
  for (const budget of data.budgets) checkAmount(budget.id, "budget.amount", budget.amount, budget.isArchived ? "cancelled" : "active");
  for (const payment of data.clientPayments) {
    checkAmount(payment.id, "clientPayment.netAmount", payment.netAmount, payment.status);
    checkAmount(payment.id, "clientPayment.totalAmount", payment.totalAmount, payment.status);
    if (!isFiniteAmount(payment.vatAmount)) {
      bad.push(payment.id);
      details.push(`clientPayment.vatAmount ${payment.id}: monto no finito ${String(payment.vatAmount)}`);
    }
  }
  for (const template of data.commitmentTemplates) checkAmount(template.id, "commitmentTemplate.amount", template.amount, template.isActive === false ? "cancelled" : "active");
  for (const instance of data.commitmentInstances) checkAmount(instance.id, "commitmentInstance.expectedAmount", instance.expectedAmount, instance.status);
  for (const movement of data.importedMovements) checkAmount(movement.id, "importedMovement.amount", movement.amount, movement.status);
  for (const statement of data.creditCardStatements) {
    checkAmount(statement.id, "creditCardStatement.montoFacturado", statement.montoFacturado, "active");
    if (statement.deudaInternacionalUsd != null && !isFiniteAmount(statement.deudaInternacionalUsd)) {
      bad.push(statement.id);
      details.push(`creditCardStatement.deudaInternacionalUsd ${statement.id}: no finito`);
    }
  }
  addFinding(findings, "P2", "Montos no finitos o <= 0 no permitidos", bad, details);
}

// P2 — Duplicados de transactions por huella.
{
  const groups = new Map<string, Transaction[]>();
  for (const tx of data.transactions) {
    const normalized = normalizeTransaction(tx);
    const key = [
      tx.date,
      norm(tx.name),
      Math.round((Number(tx.amount) || 0) * 100),
      normalized.movementType,
      normalized.accountId ?? normalized.cardAccountId ?? "",
      tx.importBatchId ?? "",
    ].join("__");
    groups.set(key, [...(groups.get(key) ?? []), tx]);
  }
  const duplicateGroups = Array.from(groups.values()).filter((group) => group.length > 1);
  addFinding(
    findings,
    "P2",
    "Duplicados de transactions por huella",
    duplicateGroups.flatMap((group) => group.map((tx) => tx.id)),
    duplicateGroups.map((group) => `${group.length}x ${group[0]?.date} ${group[0]?.name} ${group[0]?.amount}: ${group.map((tx) => tx.id).join(", ")}`),
  );
}

// P2 — creditCardStatements.
{
  const bad: string[] = [];
  const details: string[] = [];
  for (const statement of data.creditCardStatements) {
    const matches = creditCardsByLast4.get(statement.last4) ?? [];
    if (matches.length === 0) {
      bad.push(statement.id);
      details.push(`statement ${statement.id}: last4 ${statement.last4} no resoluble contra cuenta credit_card`);
    }
    if (statement.periodStart && statement.periodEnd && statement.periodStart > statement.periodEnd) {
      bad.push(statement.id);
      details.push(`statement ${statement.id}: periodStart > periodEnd (${statement.periodStart} > ${statement.periodEnd})`);
    }
    if (statement.paymentMonthKey && statement.pagarHasta && !statement.pagarHasta.startsWith(statement.paymentMonthKey)) {
      bad.push(statement.id);
      details.push(`statement ${statement.id}: paymentMonthKey ${statement.paymentMonthKey} no coincide con pagarHasta ${statement.pagarHasta}`);
    }
    if (
      statement.cupoTotal != null &&
      statement.cupoUtilizado != null &&
      Number(statement.cupoUtilizado) > Number(statement.cupoTotal) + 1
    ) {
      bad.push(statement.id);
      details.push(`statement ${statement.id}: cupoUtilizado > cupoTotal`);
    }
    if (Number(statement.montoFacturado) < 0 || Number(statement.montoMinimo ?? 0) < 0) {
      bad.push(statement.id);
      details.push(`statement ${statement.id}: montos negativos`);
    }
  }
  addFinding(findings, "P2", "creditCardStatements con last4/periodos/montos incoherentes", bad, details);
}

const bySeverity: Record<Severity, Finding[]> = { P0: [], P1: [], P2: [] };
for (const finding of findings) bySeverity[finding.severity].push(finding);

console.log("===== AUDITORIA DATOS FULL (READ-ONLY) =====");
console.log(`Proyecto esperado: my-cash-flow-bcb24`);
console.log("Colecciones leidas:");
for (const [name, count] of Object.entries(collectionMeta(data))) {
  console.log(`  ${name}: ${count}`);
}

for (const severity of ["P0", "P1", "P2"] as Severity[]) {
  console.log(`\n===== ${severity} =====`);
  for (const finding of bySeverity[severity]) printFinding(finding);
}

console.log("\n===== RESUMEN PRIORIZADO =====");
for (const severity of ["P0", "P1", "P2"] as Severity[]) {
  const nonOk = bySeverity[severity].filter((finding) => finding.count > 0);
  const total = nonOk.reduce((sum, finding) => sum + finding.count, 0);
  if (!nonOk.length) {
    console.log(`${severity}: OK`);
    continue;
  }
  console.log(`${severity}: ${nonOk.length} chequeos con hallazgos (${total} referencias).`);
  for (const finding of nonOk) {
    console.log(`  - ${finding.check}: ${finding.count} (${finding.examples.slice(0, 5).join(", ")})`);
  }
}
console.log("\nREAD-ONLY: no se ejecutaron escrituras.");
