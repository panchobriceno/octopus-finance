import type { ImportedMovement, MovementRule, Transaction } from "@shared/schema";

export type ImportedMovementDashboard = {
  total: number;
  pending: number;
  converted: number;
  reconciled: number;
  discarded: number;
  duplicate: number;
  pendingIncome: number;
  pendingExpense: number;
  convertedAmount: number;
  averageConfidence: number;
};

export type ImportBatchLifecycleStatus = "reviewing" | "partially_converted" | "completed" | "closed";

export type ImportBatchLifecycleSummary = {
  total: number;
  pending: number;
  duplicate: number;
  converted: number;
  reconciled: number;
  discarded: number;
  unresolved: number;
};

export type ImportedMovementOverride = {
  name?: string;
  category?: string;
  workspace?: string;
  movementType?: string;
  paymentMethod?: string;
  accountId?: string | null;
  creditCardName?: string | null;
  cardAccountId?: string | null;
  destinationWorkspace?: string | null;
  destinationAccountId?: string | null;
};

export type MovementSeedInput = {
  batchId: string;
  source: string;
  sourceName: string;
  sourceType: "bank_account" | "credit_card";
  bankName?: string | null;
  accountId?: string | null;
  creditCardName?: string | null;
  date: string;
  description: string;
  amount: number;
  direction: "income" | "expense";
  category: string;
  workspace: string;
  movementType: "income" | "expense" | "transfer" | "credit_card_payment";
  paymentMethod?: "bank_account" | "credit_card" | "cash";
  destinationWorkspace?: string | null;
  destinationAccountId?: string | null;
  sourceAccountId?: string | null;
  cardAccountId?: string | null;
  installmentCount?: number | null;
  confidence?: number;
  matchedRuleId?: string | null;
  duplicateTransactionId?: string | null;
  duplicateMovementId?: string | null;
  status?: "pending" | "converted" | "reconciled" | "discarded" | "duplicate";
  notes?: string | null;
  isDemo?: boolean;
  createdAt: string;
};

export function normalizeImportText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildMovementDedupeKey(input: {
  date: string;
  description: string;
  amount: number;
  direction: string;
  sourceType?: string | null;
  accountId?: string | null;
  creditCardName?: string | null;
  bankName?: string | null;
}) {
  const sourceKey =
    input.accountId ??
    input.creditCardName ??
    input.bankName ??
    input.sourceType ??
    "unknown-source";
  const amountKey = Math.round((Number(input.amount) || 0) * 100);

  return [
    normalizeImportText(sourceKey),
    input.date,
    normalizeImportText(input.direction),
    amountKey,
    normalizeImportText(input.description),
  ].join("__");
}

export function buildTransactionMatchKey(input: {
  date: string;
  name: string;
  amount: number;
  movementType?: string | null;
  accountId?: string | null;
  creditCardName?: string | null;
}) {
  const amountKey = Math.round((Number(input.amount) || 0) * 100);
  return [
    input.date,
    normalizeImportText(input.name),
    amountKey,
    normalizeImportText(input.movementType ?? ""),
    normalizeImportText(input.accountId ?? input.creditCardName ?? ""),
  ].join("__");
}

export function buildTransactionMatchKeyFromTransaction(transaction: Pick<
  Transaction,
  "date" | "name" | "amount" | "movementType" | "type" | "accountId" | "creditCardName"
>) {
  return buildTransactionMatchKey({
    date: transaction.date,
    name: transaction.name,
    amount: Number(transaction.amount) || 0,
    movementType: transaction.movementType ?? (transaction.type === "income" ? "income" : "expense"),
    accountId: transaction.accountId ?? null,
    creditCardName: transaction.creditCardName ?? null,
  });
}

export function findMatchingTransactionForPayload(
  payload: Omit<Transaction, "id">,
  transactions: Transaction[],
) {
  const targetKey = buildTransactionMatchKeyFromTransaction(payload);

  return transactions.find((transaction) => {
    if ((transaction.status ?? "paid") === "cancelled") return false;
    return buildTransactionMatchKeyFromTransaction(transaction) === targetKey;
  }) ?? null;
}

function movementRuleScore(rule: MovementRule, movement: ImportedMovement) {
  if (rule.isActive === false) return 0;
  if (rule.amountDirection !== "any" && rule.amountDirection !== movement.direction) return 0;

  const haystack = normalizeImportText([
    movement.description,
    movement.rawDescription,
    movement.sourceName,
    movement.bankName,
    movement.creditCardName,
  ].filter(Boolean).join(" "));
  const keywords = rule.keywords.map(normalizeImportText).filter(Boolean);
  if (!keywords.length) return 0;

  const matchedKeywords = keywords.filter((keyword) => haystack.includes(keyword));
  if (!matchedKeywords.length) return 0;

  return matchedKeywords.length * 20 + (Number(rule.priority) || 0);
}

export function findBestMovementRule(movement: ImportedMovement, rules: MovementRule[]) {
  return rules
    .map((rule) => ({ rule, score: movementRuleScore(rule, movement) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.rule ?? null;
}

export function applyMovementRule(movement: ImportedMovement, rule: MovementRule | null): ImportedMovement {
  if (!rule) return movement;

  const currentConfidence = Number(movement.confidence) || 0;
  const keywordCount = rule.keywords.map(normalizeImportText).filter(Boolean).length;
  const ruleConfidence = Math.min(88, 76 + keywordCount * 4 + Math.max(Number(rule.priority) || 0, 0));

  return {
    ...movement,
    suggestedCategory: rule.category,
    suggestedWorkspace: rule.workspace,
    suggestedMovementType: rule.movementType,
    suggestedPaymentMethod: rule.paymentMethod,
    accountId: rule.accountId ?? movement.accountId,
    creditCardName: rule.creditCardName ?? movement.creditCardName,
    matchedRuleId: rule.id,
    confidence: Math.max(currentConfidence, ruleConfidence),
  };
}

export function buildImportedMovement(input: MovementSeedInput): Omit<ImportedMovement, "id"> {
  const amount = Math.abs(Number(input.amount) || 0);
  const dedupeKey = buildMovementDedupeKey({
    date: input.date,
    description: input.description,
    amount,
    direction: input.direction,
    sourceType: input.sourceType,
    accountId: input.accountId,
    creditCardName: input.creditCardName,
    bankName: input.bankName,
  });
  const paymentMethod =
    input.paymentMethod ??
    (input.sourceType === "credit_card" ? "credit_card" : "bank_account");

  return {
    batchId: input.batchId,
    externalId: null,
    dedupeKey,
    source: input.source,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    bankName: input.bankName ?? null,
    accountId: input.accountId ?? null,
    creditCardName: input.creditCardName ?? null,
    date: input.date,
    description: input.description,
    rawDescription: input.description,
    amount,
    direction: input.direction,
    currency: "CLP",
    suggestedName: input.description,
    suggestedCategory: input.category,
    suggestedWorkspace: input.workspace,
    suggestedMovementType: input.movementType,
    suggestedPaymentMethod: paymentMethod,
    suggestedDestinationWorkspace: input.destinationWorkspace ?? null,
    suggestedDestinationAccountId: input.destinationAccountId ?? null,
    suggestedSourceAccountId: input.sourceAccountId ?? null,
    cardAccountId: input.cardAccountId ?? null,
    installmentCount: input.installmentCount ?? null,
    confidence: input.confidence ?? 72,
    matchedRuleId: input.matchedRuleId ?? null,
    duplicateTransactionId: input.duplicateTransactionId ?? null,
    duplicateMovementId: input.duplicateMovementId ?? null,
    status: input.status ?? "pending",
    matchedTransactionId: null,
    notes: input.notes ?? null,
    discardReason: null,
    isDemo: input.isDemo ?? false,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    convertedAt: null,
    discardedAt: null,
  };
}

export function buildTransactionFromImportedMovement(
  movement: ImportedMovement,
  override: ImportedMovementOverride = {},
): Omit<Transaction, "id"> {
  const movementType = override.movementType ?? movement.suggestedMovementType;
  const paymentMethod = override.paymentMethod ?? movement.suggestedPaymentMethod;
  const isIncome = movementType === "income";
  const isCreditCardPurchase = movementType === "expense" && paymentMethod === "credit_card";
  const status = isCreditCardPurchase ? "pending" : "paid";

  return {
    name: override.name?.trim() || movement.suggestedName || movement.description,
    category: override.category?.trim() || movement.suggestedCategory,
    amount: Math.abs(Number(movement.amount) || 0),
    type: isIncome ? "income" : "expense",
    date: movement.date,
    notes: movement.notes,
    subtype: "actual",
    status,
    itemId: null,
    workspace: override.workspace ?? movement.suggestedWorkspace,
    movementType,
    paymentMethod,
    destinationWorkspace:
      override.destinationWorkspace ??
      movement.suggestedDestinationWorkspace ??
      null,
    destinationAccountId:
      override.destinationAccountId ??
      movement.suggestedDestinationAccountId ??
      null,
    creditCardName:
      override.creditCardName ??
      movement.creditCardName ??
      null,
    cardAccountId:
      override.cardAccountId ??
      movement.cardAccountId ??
      null,
    installmentCount: movement.installmentCount ?? null,
    // origen del traspaso: usa la cuenta ORIGEN sugerida (no pisa accountId/procedencia del import)
    accountId: override.accountId ?? movement.suggestedSourceAccountId ?? movement.accountId ?? null,
    sourceClientPaymentId: null,
    importBatchId: movement.batchId,
    importBatchLabel: movement.sourceName,
    importedAt: new Date().toISOString(),
  };
}

export function buildImportedMovementDashboard(
  movements: ImportedMovement[],
): ImportedMovementDashboard {
  const pending = movements.filter((movement) => movement.status === "pending");
  const converted = movements.filter((movement) => movement.status === "converted");
  const reconciled = movements.filter((movement) => movement.status === "reconciled");
  const confidenceValues = movements
    .map((movement) => Number(movement.confidence) || 0)
    .filter((value) => value > 0);

  return {
    total: movements.length,
    pending: pending.length,
    converted: converted.length,
    reconciled: reconciled.length,
    discarded: movements.filter((movement) => movement.status === "discarded").length,
    duplicate: movements.filter((movement) => movement.status === "duplicate").length,
    pendingIncome: pending
      .filter((movement) => movement.suggestedMovementType === "income")
      .reduce((sum, movement) => sum + movement.amount, 0),
    pendingExpense: pending
      .filter((movement) => movement.suggestedMovementType !== "income")
      .reduce((sum, movement) => sum + movement.amount, 0),
    convertedAmount: converted.reduce((sum, movement) => sum + movement.amount, 0),
    averageConfidence: confidenceValues.length
      ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length)
      : 0,
  };
}

export function summarizeImportBatchLifecycle(movements: ImportedMovement[]): ImportBatchLifecycleSummary {
  const pending = movements.filter((movement) => movement.status === "pending").length;
  const duplicate = movements.filter((movement) => movement.status === "duplicate").length;
  const converted = movements.filter((movement) => movement.status === "converted").length;
  const reconciled = movements.filter((movement) => movement.status === "reconciled").length;
  const discarded = movements.filter((movement) => movement.status === "discarded").length;

  return {
    total: movements.length,
    pending,
    duplicate,
    converted,
    reconciled,
    discarded,
    unresolved: pending + duplicate,
  };
}

export function getImportBatchLifecycleStatus(
  summary: ImportBatchLifecycleSummary,
  currentStatus?: string | null,
): ImportBatchLifecycleStatus {
  if (currentStatus === "closed") return "closed";
  if (summary.total > 0 && summary.unresolved === 0) return "completed";
  if (summary.converted > 0 || summary.reconciled > 0 || summary.discarded > 0) return "partially_converted";
  return "reviewing";
}
