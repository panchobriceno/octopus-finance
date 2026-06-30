import type { Account, ImportBatch, ImportedMovement, Transaction } from "@shared/schema";
import { isExecutedTransaction, normalizeTransaction } from "@/lib/finance";
import { normalizeImportText } from "./bank-imports";
import { resolveCardAccount } from "./account-identity";

export type ReconciliationStatus =
  | "confident_match"
  | "possible_match"
  | "missing_transaction"
  | "possible_duplicate"
  | "resolved"
  | "discarded";

export type ReconciliationCandidate = {
  transaction: Transaction;
  score: number;
  reasons: string[];
  dateDistance: number;
  amountDelta: number;
};

export type ReconciliationRow = {
  id: string;
  movement: ImportedMovement;
  batch: ImportBatch | null;
  status: ReconciliationStatus;
  statusLabel: string;
  importedImpact: number;
  bestCandidate: ReconciliationCandidate | null;
  candidates: ReconciliationCandidate[];
};

export type AccountReconciliationSummary = {
  account: Account;
  monthKey: string;
  openingBalanceEstimate: number;
  currentBalance: number;
  importedIncome: number;
  importedExpense: number;
  importedNet: number;
  registeredIncome: number;
  registeredExpense: number;
  registeredNet: number;
  difference: number;
  importedCount: number;
  registeredCount: number;
  openBatchCount: number;
  unresolvedCount: number;
  confidentMatchCount: number;
  possibleMatchCount: number;
  missingCount: number;
  duplicateCount: number;
  resolvedCount: number;
  discardedCount: number;
  unmatchedRegisteredCount: number;
};

export type AccountReconciliationWorkspace = AccountReconciliationSummary & {
  rows: ReconciliationRow[];
  registeredTransactions: Transaction[];
  unmatchedRegisteredTransactions: Transaction[];
};

const STATUS_LABELS: Record<ReconciliationStatus, string> = {
  confident_match: "Match confiable",
  possible_match: "Posible match",
  missing_transaction: "Sin registrar",
  possible_duplicate: "Posible duplicado",
  resolved: "Resuelto",
  discarded: "Descartado",
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMonthEnd(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const day = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(day).padStart(2, "0")}`;
}

function isDateInMonth(date: string | null | undefined, monthKey: string) {
  return typeof date === "string" && date.startsWith(monthKey);
}

function batchTouchesMonth(batch: ImportBatch, monthKey: string) {
  if (batch.periodStart?.startsWith(monthKey) || batch.periodEnd?.startsWith(monthKey)) return true;
  if (!batch.periodStart && !batch.periodEnd && batch.createdAt?.startsWith(monthKey)) return true;
  if (!batch.periodStart || !batch.periodEnd) return false;
  return batch.periodStart <= getMonthEnd(monthKey) && batch.periodEnd >= `${monthKey}-01`;
}

function dateDistanceInDays(left: string, right: string) {
  const leftDate = new Date(`${left}T00:00:00Z`).getTime();
  const rightDate = new Date(`${right}T00:00:00Z`).getTime();
  if (!Number.isFinite(leftDate) || !Number.isFinite(rightDate)) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(leftDate - rightDate) / 86400000);
}

function accountLabels(account: Pick<Account, "id" | "name" | "bank">) {
  return [
    account.id,
    account.name,
    account.bank,
    `${account.bank} ${account.name}`,
    `${account.name} ${account.bank}`,
  ].map(normalizeImportText).filter(Boolean);
}

function textMentionsAccount(value: string | null | undefined, account: Account) {
  const normalized = normalizeImportText(value);
  if (!normalized) return false;
  return accountLabels(account).some((label) => label && normalized.includes(label));
}

function creditCardMatchesAccount(value: string | null | undefined, account: Account) {
  const normalized = normalizeImportText(value);
  if (!normalized) return false;
  return accountLabels(account).some((label) =>
    label && (normalized === label || normalized.includes(label) || label.includes(normalized)),
  );
}

/**
 * ¿Esta referencia de tarjeta (cardAccountId/creditCardName) pertenece a `account`?
 * ESTRUCTURAL primero: resolveCardAccount(ref, accounts) usa cardAccountId → last4 ÚNICO → nombre,
 * y devuelve null si hay AMBIGÜEDAD (dos tarjetas con mismo last4). Si no resuelve, cae al
 * match por nombre legacy (creditCardMatchesAccount). Pasar `accounts` evita el doble-match.
 */
function cardBelongsToAccount(
  ref: { cardAccountId?: string | null; creditCardName?: string | null },
  account: Account,
  accounts: Account[],
) {
  const resolved = resolveCardAccount(ref, accounts);
  if (resolved) return resolved.id === account.id;
  // Si HAY señal estructural (cardAccountId o last4 en el nombre) pero no resolvió, es ambiguo o
  // no-encontrado → NO caemos al fuzzy por nombre (eso reabriría el doble-match). Solo fuzzy si
  // no hay ninguna señal estructural (datos viejos sin last4).
  const hasStructural = Boolean(ref.cardAccountId) || /\d{4}\s*$/.test(String(ref.creditCardName ?? ""));
  if (hasStructural) return false;
  return creditCardMatchesAccount(ref.creditCardName, account);
}

export function importedMovementBelongsToAccount(movement: ImportedMovement, account: Account, accounts: Account[] = [account]) {
  if (movement.accountId === account.id) return true;

  if (account.type === "credit_card") {
    // Solo cartolas de TARJETA (sourceType credit_card). Un pago de tarjeta en una cartola
    // bancaria tiene cardAccountId pero direction=gasto banco → contarlo acá invertiría el signo.
    // Solo por identidad de tarjeta (sin textMentions(sourceName): "Santander" tocaría
    // todas las tarjetas Santander → doble-match).
    return movement.sourceType === "credit_card" && cardBelongsToAccount(movement, account, accounts);
  }

  return (
    movement.sourceType === "bank_account" &&
    !movement.accountId &&
    (
      textMentionsAccount(movement.bankName, account) ||
      textMentionsAccount(movement.sourceName, account)
    )
  );
}

export function transactionTouchesAccount(transaction: Transaction, account: Account, accounts: Account[] = [account]) {
  const normalized = normalizeTransaction(transaction);
  if (normalized.status === "cancelled" || !isExecutedTransaction(normalized)) return false;

  if (account.type === "credit_card") {
    return (
      normalized.paymentMethod === "credit_card" &&
      normalized.movementType === "expense" &&
      cardBelongsToAccount(normalized, account, accounts)
    ) || (
      normalized.movementType === "credit_card_payment" &&
      cardBelongsToAccount(normalized, account, accounts)
    );
  }

  return normalized.accountId === account.id || normalized.destinationAccountId === account.id;
}

export function getImportedMovementImpact(movement: ImportedMovement) {
  const amount = toNumber(movement.amount);
  return movement.direction === "income" ? amount : -amount;
}

export function getTransactionAccountImpact(transaction: Transaction, account: Account, accounts: Account[] = [account]) {
  const normalized = normalizeTransaction(transaction);
  const amount = toNumber(normalized.amount);

  if (!transactionTouchesAccount(normalized, account, accounts)) return 0;

  if (account.type === "credit_card") {
    if (normalized.movementType === "credit_card_payment") return amount;
    if (normalized.movementType === "expense" && normalized.paymentMethod === "credit_card") return -amount;
    return 0;
  }

  if (normalized.destinationAccountId === account.id && normalized.movementType === "transfer") {
    return amount;
  }

  if (normalized.accountId !== account.id) return 0;
  if (normalized.movementType === "income") return amount;
  if (normalized.movementType === "expense" && normalized.paymentMethod !== "credit_card") return -amount;
  if (normalized.movementType === "credit_card_payment") return -amount;
  if (normalized.movementType === "transfer") return -amount;
  return 0;
}

function amountScore(movement: ImportedMovement, transaction: Transaction) {
  const delta = Math.abs(toNumber(movement.amount) - toNumber(transaction.amount));
  const base = Math.max(toNumber(movement.amount), toNumber(transaction.amount), 1);
  if (delta <= 1) return { score: 38, reason: "monto exacto", delta };
  if (delta / base <= 0.02) return { score: 24, reason: "monto similar", delta };
  if (delta / base <= 0.05) return { score: 12, reason: "monto cercano", delta };
  return { score: 0, reason: "", delta };
}

function dateScore(movement: ImportedMovement, transaction: Transaction) {
  const distance = dateDistanceInDays(movement.date, transaction.date);
  if (distance === 0) return { score: 26, reason: "misma fecha", distance };
  if (distance === 1) return { score: 18, reason: "fecha a 1 dia", distance };
  if (distance <= 3) return { score: 10, reason: "fecha cercana", distance };
  return { score: 0, reason: "", distance };
}

function movementTypeFromImport(movement: ImportedMovement) {
  return movement.suggestedMovementType || (movement.direction === "income" ? "income" : "expense");
}

function transactionTypeForMatch(transaction: Transaction) {
  const normalized = normalizeTransaction(transaction);
  return normalized.movementType ?? (normalized.type === "income" ? "income" : "expense");
}

function movementTypesCompatible(movement: ImportedMovement, transaction: Transaction) {
  const movementType = movementTypeFromImport(movement);
  const transactionType = transactionTypeForMatch(transaction);
  if (movementType === transactionType) return true;
  if (movement.direction === "income" && transactionType === "income") return true;
  if (movement.direction === "expense" && transactionType === "expense") return true;
  return false;
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeImportText(left).split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(normalizeImportText(right).split(" ").filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

export function scoreReconciliationCandidate(
  movement: ImportedMovement,
  transaction: Transaction,
  account: Account,
  accounts: Account[] = [account],
): ReconciliationCandidate | null {
  const amount = amountScore(movement, transaction);
  const date = dateScore(movement, transaction);
  const reasons: string[] = [];
  let score = 0;

  if (amount.score > 0) {
    score += amount.score;
    reasons.push(amount.reason);
  }
  if (date.score > 0) {
    score += date.score;
    reasons.push(date.reason);
  }
  if (transactionTouchesAccount(transaction, account, accounts)) {
    score += 14;
    reasons.push("misma cuenta");
  }
  if (movementTypesCompatible(movement, transaction)) {
    score += 12;
    reasons.push("mismo tipo");
  }

  const textScore = tokenSimilarity(movement.description, transaction.name);
  if (textScore >= 0.75) {
    score += 14;
    reasons.push("nombre muy similar");
  } else if (textScore >= 0.4) {
    score += 8;
    reasons.push("nombre similar");
  }

  if (movement.matchedTransactionId === transaction.id || movement.duplicateTransactionId === transaction.id) {
    score += 25;
    reasons.push("ya vinculado");
  }

  if (score < 45) return null;
  return {
    transaction,
    score: Math.min(100, score),
    reasons,
    dateDistance: date.distance,
    amountDelta: amount.delta,
  };
}

function getRowStatus(movement: ImportedMovement, bestCandidate: ReconciliationCandidate | null): ReconciliationStatus {
  if (movement.status === "discarded") return "discarded";
  if (movement.status === "converted" || movement.status === "reconciled") return "resolved";
  if (movement.status === "duplicate" || movement.duplicateTransactionId) return "possible_duplicate";
  if (!bestCandidate) return "missing_transaction";
  if (bestCandidate.score >= 84) return "confident_match";
  return "possible_match";
}

function batchBelongsToAccount(batch: ImportBatch, account: Account, accounts: Account[] = [account]) {
  if (batch.accountId === account.id) return true;
  if (account.type === "credit_card") return cardBelongsToAccount(batch, account, accounts);
  return !batch.accountId && (
    textMentionsAccount(batch.bankName, account) ||
    textMentionsAccount(batch.sourceName, account)
  );
}

export function buildAccountReconciliationWorkspace(input: {
  account: Account;
  accounts?: Account[];
  monthKey: string;
  transactions: Transaction[];
  importedMovements: ImportedMovement[];
  importBatches: ImportBatch[];
}): AccountReconciliationWorkspace {
  const { account, monthKey } = input;
  const accounts = input.accounts ?? [account];
  const batchById = new Map(input.importBatches.map((batch) => [batch.id, batch]));
  const movements = input.importedMovements
    .filter((movement) => isDateInMonth(movement.date, monthKey))
    .filter((movement) => importedMovementBelongsToAccount(movement, account, accounts))
    .sort((left, right) => {
      if (left.status !== right.status) {
        const order: Record<string, number> = { pending: 0, duplicate: 1, converted: 2, discarded: 3 };
        return (order[left.status] ?? 9) - (order[right.status] ?? 9);
      }
      if (left.date !== right.date) return right.date.localeCompare(left.date);
      return left.description.localeCompare(right.description, "es");
    });

  const registeredTransactions = input.transactions
    .filter((transaction) => isDateInMonth(transaction.date, monthKey))
    .filter((transaction) => transactionTouchesAccount(transaction, account, accounts));

  const rows = movements.map((movement): ReconciliationRow => {
    const candidates = registeredTransactions
      .map((transaction) => scoreReconciliationCandidate(movement, transaction, account, accounts))
      .filter((candidate): candidate is ReconciliationCandidate => Boolean(candidate))
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
    const bestCandidate = candidates[0] ?? null;
    const status = getRowStatus(movement, bestCandidate);

    return {
      id: movement.id,
      movement,
      batch: batchById.get(movement.batchId) ?? null,
      status,
      statusLabel: STATUS_LABELS[status],
      importedImpact: getImportedMovementImpact(movement),
      bestCandidate,
      candidates,
    };
  });

  const matchedTransactionIds = new Set(
    rows
      .flatMap((row) => [
        row.movement.matchedTransactionId,
        row.movement.duplicateTransactionId,
        row.bestCandidate && row.bestCandidate.score >= 60 ? row.bestCandidate.transaction.id : null,
      ])
      .filter((id): id is string => Boolean(id)),
  );
  const unmatchedRegisteredTransactions = registeredTransactions.filter((transaction) => !matchedTransactionIds.has(transaction.id));
  const importedTotals = movements.reduce((acc, movement) => {
    if (movement.status === "discarded") return acc;
    const amount = toNumber(movement.amount);
    if (movement.direction === "income") acc.income += amount;
    else acc.expense += amount;
    return acc;
  }, { income: 0, expense: 0 });
  const registeredNet = registeredTransactions.reduce((sum, transaction) => sum + getTransactionAccountImpact(transaction, account, accounts), 0);
  const registeredIncome = registeredTransactions.reduce((sum, transaction) => {
    const impact = getTransactionAccountImpact(transaction, account, accounts);
    return impact > 0 ? sum + impact : sum;
  }, 0);
  const registeredExpense = registeredTransactions.reduce((sum, transaction) => {
    const impact = getTransactionAccountImpact(transaction, account, accounts);
    return impact < 0 ? sum + Math.abs(impact) : sum;
  }, 0);
  const importedNet = importedTotals.income - importedTotals.expense;
  const currentBalance = toNumber(account.currentBalance);
  const statusCounts = rows.reduce<Record<ReconciliationStatus, number>>((acc, row) => {
    acc[row.status] += 1;
    return acc;
  }, {
    confident_match: 0,
    possible_match: 0,
    missing_transaction: 0,
    possible_duplicate: 0,
    resolved: 0,
    discarded: 0,
  });
  const openBatchCount = input.importBatches.filter((batch) =>
    batch.status !== "closed" &&
    batchTouchesMonth(batch, monthKey) &&
    batchBelongsToAccount(batch, account, accounts),
  ).length;

  return {
    account,
    monthKey,
    openingBalanceEstimate: currentBalance - registeredNet,
    currentBalance,
    importedIncome: importedTotals.income,
    importedExpense: importedTotals.expense,
    importedNet,
    registeredIncome,
    registeredExpense,
    registeredNet,
    difference: importedNet - registeredNet,
    importedCount: movements.filter((movement) => movement.status !== "discarded").length,
    registeredCount: registeredTransactions.length,
    openBatchCount,
    unresolvedCount: statusCounts.possible_match + statusCounts.missing_transaction + statusCounts.possible_duplicate,
    confidentMatchCount: statusCounts.confident_match,
    possibleMatchCount: statusCounts.possible_match,
    missingCount: statusCounts.missing_transaction,
    duplicateCount: statusCounts.possible_duplicate,
    resolvedCount: statusCounts.resolved,
    discardedCount: statusCounts.discarded,
    unmatchedRegisteredCount: unmatchedRegisteredTransactions.length,
    rows,
    registeredTransactions,
    unmatchedRegisteredTransactions,
  };
}

export function buildAllAccountReconciliationSummaries(input: {
  accounts: Account[];
  monthKey: string;
  transactions: Transaction[];
  importedMovements: ImportedMovement[];
  importBatches: ImportBatch[];
}) {
  return input.accounts.map((account) =>
    buildAccountReconciliationWorkspace({
      account,
      accounts: input.accounts,
      monthKey: input.monthKey,
      transactions: input.transactions,
      importedMovements: input.importedMovements,
      importBatches: input.importBatches,
    }),
  );
}
