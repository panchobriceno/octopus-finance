import type { CommitmentInstance, CommitmentTemplate, Transaction } from "@shared/schema";
import { isExecutedTransaction, normalizeTransaction } from "@/lib/finance";

export type CommitmentMatch = {
  instance: CommitmentInstance;
  transaction: Transaction;
  score: number;
  reasons: string[];
};

export type CommitmentDashboard = {
  total: number;
  pending: number;
  paid: number;
  skipped: number;
  overdue: number;
  expectedOutflow: number;
  paidOutflow: number;
  pendingOutflow: number;
  coveragePct: number;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function daysBetween(left: string, right: string) {
  const leftTime = parseDate(left).getTime();
  const rightTime = parseDate(right).getTime();
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((leftTime - rightTime) / 86_400_000));
}

function clampDay(year: number, month: number, day: number) {
  const daysInMonth = new Date(year, month, 0).getDate();
  return Math.min(Math.max(day, 1), daysInMonth);
}

export function getCurrentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export function buildCommitmentDueDate(monthKey: string, dayOfMonth: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const day = clampDay(year, month, dayOfMonth);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getCommitmentIdentity(templateId: string, monthKey: string) {
  return `${templateId}::${monthKey}`;
}

export function buildCommitmentInstanceFromTemplate(
  template: CommitmentTemplate,
  monthKey: string,
): Omit<CommitmentInstance, "id"> {
  const now = new Date().toISOString();
  return {
    templateId: template.id,
    monthKey,
    name: template.name,
    category: template.category,
    expectedAmount: Number(template.amount) || 0,
    amountMode: template.amountMode ?? "fixed",
    dueDate: buildCommitmentDueDate(monthKey, Number(template.dayOfMonth) || 1),
    workspace: template.workspace ?? "family",
    movementType: template.movementType ?? "expense",
    paymentMethod: template.paymentMethod ?? "bank_account",
    accountId: template.accountId ?? null,
    destinationAccountId: template.destinationAccountId ?? null,
    creditCardName: template.creditCardName ?? null,
    status: "pending",
    matchedTransactionId: null,
    matchedAt: null,
    paidAt: null,
    notes: template.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildMissingCommitmentInstances(
  templates: CommitmentTemplate[],
  existingInstances: CommitmentInstance[],
  monthKey: string,
) {
  const existingKeys = new Set(
    existingInstances.map((instance) => getCommitmentIdentity(instance.templateId, instance.monthKey)),
  );

  return templates
    .filter((template) => template.isActive !== false)
    .filter((template) => !existingKeys.has(getCommitmentIdentity(template.id, monthKey)))
    .map((template) => buildCommitmentInstanceFromTemplate(template, monthKey));
}

function includesKeyword(transaction: Transaction, keywords: string[]) {
  if (!keywords.length) return { matches: true, matched: [] as string[] };

  const haystack = normalizeText([
    transaction.name,
    transaction.category,
    transaction.notes,
    transaction.importBatchLabel,
    transaction.creditCardName,
  ].filter(Boolean).join(" "));
  const matched = keywords
    .map(normalizeText)
    .filter(Boolean)
    .filter((keyword) => haystack.includes(keyword));

  return { matches: matched.length > 0, matched };
}

function getTemplateForInstance(
  instance: CommitmentInstance,
  templatesById: Map<string, CommitmentTemplate>,
) {
  return templatesById.get(instance.templateId) ?? null;
}

function getAmountTolerance(instance: CommitmentInstance, template: CommitmentTemplate | null) {
  if (instance.amountMode === "variable") return Number.POSITIVE_INFINITY;
  return Number(template?.amountTolerance ?? 1000);
}

function getDateTolerance(template: CommitmentTemplate | null) {
  return Number(template?.dateToleranceDays ?? 5);
}

function scoreTransaction(
  instance: CommitmentInstance,
  transaction: Transaction,
  template: CommitmentTemplate | null,
) {
  const normalized = normalizeTransaction(transaction);
  if (normalized.status === "cancelled" || !isExecutedTransaction(normalized)) return null;
  if (transaction.sourceClientPaymentId) return null;
  if (!transaction.date.startsWith(instance.monthKey)) return null;

  if (normalized.movementType !== instance.movementType) return null;
  if (instance.paymentMethod && normalized.paymentMethod !== instance.paymentMethod) return null;
  if (instance.workspace && normalized.workspace !== instance.workspace) return null;
  if (instance.accountId && transaction.accountId !== instance.accountId) return null;
  if (instance.destinationAccountId && transaction.destinationAccountId !== instance.destinationAccountId) return null;
  if (
    instance.creditCardName &&
    normalizeText(transaction.creditCardName) !== normalizeText(instance.creditCardName)
  ) {
    return null;
  }

  const amountDiff = Math.abs((Number(transaction.amount) || 0) - (Number(instance.expectedAmount) || 0));
  const amountTolerance = getAmountTolerance(instance, template);
  if (amountDiff > amountTolerance) return null;

  const dayDiff = daysBetween(transaction.date, instance.dueDate);
  const dateTolerance = getDateTolerance(template);
  if (dayDiff > dateTolerance) return null;

  const keywords = template?.matchingKeywords ?? [];
  const keywordResult = includesKeyword(transaction, keywords);
  if (!keywordResult.matches) return null;

  const reasons: string[] = [];
  let score = 0;

  if (instance.accountId) {
    score += 20;
    reasons.push("cuenta");
  }
  if (instance.creditCardName) {
    score += 20;
    reasons.push("tarjeta");
  }
  if (keywordResult.matched.length > 0) {
    score += 25;
    reasons.push(`keyword:${keywordResult.matched.join(",")}`);
  }
  if (amountDiff === 0) {
    score += 25;
    reasons.push("monto exacto");
  } else if (Number.isFinite(amountTolerance)) {
    score += Math.max(0, 20 - Math.round((amountDiff / Math.max(amountTolerance, 1)) * 20));
    reasons.push(`monto +/-${amountDiff}`);
  } else {
    score += 5;
    reasons.push("monto variable");
  }
  score += Math.max(0, 15 - dayDiff);
  reasons.push(`fecha ${dayDiff}d`);

  return { transaction, score, reasons };
}

export function findCommitmentMatches(
  instances: CommitmentInstance[],
  templates: CommitmentTemplate[],
  transactions: Transaction[],
): CommitmentMatch[] {
  const templatesById = new Map(templates.map((template) => [template.id, template]));
  const usedTransactionIds = new Set<string>();
  const matches: CommitmentMatch[] = [];

  const pendingInstances = instances
    .filter((instance) => instance.status === "pending" && !instance.matchedTransactionId)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));

  for (const instance of pendingInstances) {
    const template = getTemplateForInstance(instance, templatesById);
    const candidates = transactions
      .filter((transaction) => !usedTransactionIds.has(transaction.id))
      .map((transaction) => scoreTransaction(instance, transaction, template))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .sort((left, right) => right.score - left.score);

    const best = candidates[0];
    if (!best || best.score < 25) continue;

    usedTransactionIds.add(best.transaction.id);
    matches.push({
      instance,
      transaction: best.transaction,
      score: best.score,
      reasons: best.reasons,
    });
  }

  return matches;
}

export function buildCommitmentDashboard(
  instances: CommitmentInstance[],
  today = new Date().toISOString().slice(0, 10),
): CommitmentDashboard {
  const total = instances.length;
  const paid = instances.filter((instance) => instance.status === "paid").length;
  const skipped = instances.filter((instance) => instance.status === "skipped").length;
  const pending = instances.filter((instance) => instance.status === "pending").length;
  const overdue = instances.filter(
    (instance) => instance.status === "pending" && instance.dueDate < today,
  ).length;
  const expectedOutflow = instances.reduce((sum, instance) => sum + (Number(instance.expectedAmount) || 0), 0);
  const paidOutflow = instances.reduce(
    (sum, instance) => instance.status === "paid" ? sum + (Number(instance.expectedAmount) || 0) : sum,
    0,
  );
  const pendingOutflow = instances.reduce(
    (sum, instance) => instance.status === "pending" ? sum + (Number(instance.expectedAmount) || 0) : sum,
    0,
  );

  return {
    total,
    pending,
    paid,
    skipped,
    overdue,
    expectedOutflow,
    paidOutflow,
    pendingOutflow,
    coveragePct: total > 0 ? Math.round((paid / total) * 100) : 0,
  };
}
