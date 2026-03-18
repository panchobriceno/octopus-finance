import type { ClientPayment, Transaction } from "@shared/schema";
import { getMonthName } from "./utils";
import type { MonthlyBalanceMap } from "./monthly-balances";

export type Workspace = "business" | "family";
export type WorkspaceFilter = Workspace | "all";

export interface NormalizedTransaction extends Transaction {
  workspace: Workspace;
  movementType: "income" | "expense" | "transfer" | "credit_card_payment";
  paymentMethod: "cash" | "bank_account" | "credit_card";
  destinationWorkspace: Workspace | null;
  creditCardName: string | null;
}

export interface MonthlySummary {
  monthKey: string;
  label: string;
  openingBalance: number;
  realIncome: number;
  realExpenses: number;
  plannedIncome: number;
  plannedExpenses: number;
  realEndingBalance: number;
  projectedEndingBalance: number;
  hasRealData: boolean;
  hasPlannedData: boolean;
}

export interface DailyProjectionPoint {
  day: number;
  label: string;
  realBalance: number | null;
  projectedBalance: number;
  today: boolean;
}

export interface WorkspaceMetrics {
  income: number;
  expenses: number;
  cashFlow: number;
  creditCardDebt: number;
  transfersIn: number;
  transfersOut: number;
}

const DEFAULT_WORKSPACE: Workspace = "business";

export function getMonthKeyFromDate(date: string) {
  return date.slice(0, 7);
}

export function getMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${getMonthName(Number(month) - 1)} ${year}`;
}

export function getCurrentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export function normalizeTransaction(tx: Transaction): NormalizedTransaction {
  const movementType = (
    tx.movementType ??
    (tx.type === "income" ? "income" : "expense")
  ) as NormalizedTransaction["movementType"];

  const paymentMethod = (
    tx.paymentMethod ??
    (movementType === "expense" ? "bank_account" : "bank_account")
  ) as NormalizedTransaction["paymentMethod"];

  return {
    ...tx,
    workspace: (tx.workspace ?? DEFAULT_WORKSPACE) as Workspace,
    movementType,
    paymentMethod,
    destinationWorkspace: (tx.destinationWorkspace ?? null) as Workspace | null,
    creditCardName: tx.creditCardName ?? null,
    subtype: tx.subtype ?? "actual",
    status: tx.status ?? "paid",
  };
}

export function isPlannedTransaction(tx: Transaction) {
  const normalized = normalizeTransaction(tx);
  return normalized.subtype === "planned" && normalized.status !== "cancelled";
}

export function isExecutedTransaction(tx: Transaction) {
  const normalized = normalizeTransaction(tx);
  return normalized.subtype !== "planned" && normalized.status === "paid";
}

export function affectsWorkspace(tx: Transaction, workspace: WorkspaceFilter) {
  if (workspace === "all") return true;
  const normalized = normalizeTransaction(tx);
  return normalized.workspace === workspace || normalized.destinationWorkspace === workspace;
}

function isMatchingScope(tx: Transaction, workspace: WorkspaceFilter) {
  if (workspace === "all") return true;
  return normalizeTransaction(tx).workspace === workspace;
}

export function getTransactionIncomeImpact(tx: Transaction, workspace: WorkspaceFilter = "all") {
  const normalized = normalizeTransaction(tx);
  if (!isMatchingScope(normalized, workspace)) return 0;
  return normalized.movementType === "income" ? normalized.amount : 0;
}

export function getTransactionExpenseImpact(tx: Transaction, workspace: WorkspaceFilter = "all") {
  const normalized = normalizeTransaction(tx);
  if (!isMatchingScope(normalized, workspace)) return 0;
  return normalized.movementType === "expense" ? normalized.amount : 0;
}

export function getTransactionCashFlowImpact(tx: Transaction, workspace: WorkspaceFilter = "all") {
  const normalized = normalizeTransaction(tx);

  if (normalized.movementType === "transfer") {
    if (workspace === "all") return 0;
    if (normalized.workspace === workspace) return -normalized.amount;
    if (normalized.destinationWorkspace === workspace) return normalized.amount;
    return 0;
  }

  if (!isMatchingScope(normalized, workspace)) return 0;

  if (normalized.movementType === "income") {
    return normalized.amount;
  }

  if (normalized.movementType === "credit_card_payment") {
    return -normalized.amount;
  }

  if (normalized.movementType === "expense") {
    return normalized.paymentMethod === "credit_card" ? 0 : -normalized.amount;
  }

  return 0;
}

export function getTransactionCreditCardDebtImpact(tx: Transaction, workspace: WorkspaceFilter = "all") {
  const normalized = normalizeTransaction(tx);
  if (!isMatchingScope(normalized, workspace)) return 0;

  if (normalized.movementType === "expense" && normalized.paymentMethod === "credit_card") {
    return normalized.amount;
  }

  if (normalized.movementType === "credit_card_payment") {
    return -normalized.amount;
  }

  return 0;
}

export function summarizeWorkspaceTransactions(
  transactions: Transaction[],
  workspace: WorkspaceFilter = "all",
): WorkspaceMetrics {
  return transactions.reduce<WorkspaceMetrics>((acc, tx) => {
    if (!affectsWorkspace(tx, workspace)) return acc;

    const normalized = normalizeTransaction(tx);
    const executed = isExecutedTransaction(normalized);
    const planned = isPlannedTransaction(normalized);
    if (!executed && !planned) return acc;

    acc.income += getTransactionIncomeImpact(normalized, workspace);
    acc.expenses += getTransactionExpenseImpact(normalized, workspace);
    acc.cashFlow += getTransactionCashFlowImpact(normalized, workspace);
    acc.creditCardDebt += getTransactionCreditCardDebtImpact(normalized, workspace);

    if (normalized.movementType === "transfer" && workspace !== "all") {
      if (normalized.workspace === workspace) acc.transfersOut += normalized.amount;
      if (normalized.destinationWorkspace === workspace) acc.transfersIn += normalized.amount;
    }

    return acc;
  }, {
    income: 0,
    expenses: 0,
    cashFlow: 0,
    creditCardDebt: 0,
    transfersIn: 0,
    transfersOut: 0,
  });
}

export function clientPaymentToIncomeTransaction(payment: ClientPayment): Transaction | null {
  if (payment.status === "cancelled") return null;

  const date = payment.paymentDate ?? payment.dueDate ?? payment.issueDate;
  if (!date) return null;

  const subtype = payment.status === "paid" ? "actual" : "planned";
  const status = payment.status === "paid" ? "paid" : "pending";

  return {
    id: `client-payment-${payment.id}`,
    name: payment.clientName,
    category: "Ingresos Clientes",
    amount: payment.netAmount,
    type: "income",
    date,
    notes: payment.notes ?? null,
    subtype,
    status,
    itemId: null,
    workspace: "business",
    movementType: "income",
    paymentMethod: "bank_account",
    destinationWorkspace: null,
    creditCardName: null,
  };
}

export function combineFinancialTransactions(
  transactions: Transaction[],
  clientPayments: ClientPayment[] = [],
) {
  const paymentTransactions = clientPayments
    .map(clientPaymentToIncomeTransaction)
    .filter((tx): tx is Transaction => tx !== null);

  return [...transactions, ...paymentTransactions];
}

function ensureSummary(
  store: Record<string, Omit<MonthlySummary, "realEndingBalance" | "projectedEndingBalance">>,
  monthKey: string,
  openingBalances: MonthlyBalanceMap,
) {
  if (!store[monthKey]) {
    store[monthKey] = {
      monthKey,
      label: getMonthLabel(monthKey),
      openingBalance: openingBalances[monthKey] ?? 0,
      realIncome: 0,
      realExpenses: 0,
      plannedIncome: 0,
      plannedExpenses: 0,
      hasRealData: false,
      hasPlannedData: false,
    };
  }

  return store[monthKey];
}

export function buildMonthlySummaries(
  transactions: Transaction[],
  openingBalances: MonthlyBalanceMap = {},
  workspace: WorkspaceFilter = "all",
): MonthlySummary[] {
  const summaries: Record<string, Omit<MonthlySummary, "realEndingBalance" | "projectedEndingBalance">> = {};

  for (const [monthKey, amount] of Object.entries(openingBalances)) {
    if (typeof amount === "number" && Number.isFinite(amount)) {
      ensureSummary(summaries, monthKey, openingBalances);
    }
  }

  for (const tx of transactions) {
    const normalized = normalizeTransaction(tx);
    if (normalized.status === "cancelled" || !affectsWorkspace(normalized, workspace)) continue;

    const summary = ensureSummary(summaries, getMonthKeyFromDate(normalized.date), openingBalances);
    const cashFlowImpact = getTransactionCashFlowImpact(normalized, workspace);

    if (isExecutedTransaction(normalized)) {
      summary.hasRealData = true;
      if (cashFlowImpact >= 0) {
        summary.realIncome += cashFlowImpact;
      } else {
        summary.realExpenses += Math.abs(cashFlowImpact);
      }
      continue;
    }

    if (isPlannedTransaction(normalized)) {
      summary.hasPlannedData = true;
      if (cashFlowImpact >= 0) {
        summary.plannedIncome += cashFlowImpact;
      } else {
        summary.plannedExpenses += Math.abs(cashFlowImpact);
      }
    }
  }

  return Object.values(summaries)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((summary) => {
      const realEndingBalance = summary.openingBalance + summary.realIncome - summary.realExpenses;
      const projectedEndingBalance = realEndingBalance + summary.plannedIncome - summary.plannedExpenses;

      return {
        ...summary,
        realEndingBalance,
        projectedEndingBalance,
      };
    });
}

export function buildDailyProjectionData(
  transactions: Transaction[],
  monthKey: string,
  openingBalance: number,
  workspace: WorkspaceFilter = "all",
): DailyProjectionPoint[] {
  const [year, month] = monthKey.split("-").map(Number);
  const now = new Date();
  const todayMonthKey = getCurrentMonthKey();
  const isCurrentMonth = monthKey === todayMonthKey;
  const todayDay = isCurrentMonth ? now.getDate() : new Date(year, month, 0).getDate();
  const daysInMonth = new Date(year, month, 0).getDate();

  const executedByDay = new Map<number, number>();
  const projectedByDay = new Map<number, number>();

  for (const tx of transactions) {
    const normalized = normalizeTransaction(tx);
    if (
      getMonthKeyFromDate(normalized.date) !== monthKey ||
      normalized.status === "cancelled" ||
      !affectsWorkspace(normalized, workspace)
    ) continue;

    const day = Number(normalized.date.slice(-2));
    const delta = getTransactionCashFlowImpact(normalized, workspace);

    if (isExecutedTransaction(normalized)) {
      executedByDay.set(day, (executedByDay.get(day) ?? 0) + delta);
    } else if (isPlannedTransaction(normalized)) {
      projectedByDay.set(day, (projectedByDay.get(day) ?? 0) + delta);
    }
  }

  let runningReal = openingBalance;
  let runningProjected = openingBalance;
  const result: DailyProjectionPoint[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    runningReal += executedByDay.get(day) ?? 0;
    runningProjected += (executedByDay.get(day) ?? 0) + (projectedByDay.get(day) ?? 0);

    result.push({
      day,
      label: `${day}`,
      realBalance: day <= todayDay ? runningReal : null,
      projectedBalance: runningProjected,
      today: day === todayDay,
    });
  }

  return result;
}
