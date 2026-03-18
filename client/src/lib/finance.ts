import type { Transaction } from "@shared/schema";
import { getMonthName } from "./utils";
import type { MonthlyBalanceMap } from "./monthly-balances";

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

export function isPlannedTransaction(tx: Transaction) {
  return tx.subtype === "planned" && tx.status !== "cancelled";
}

export function isExecutedTransaction(tx: Transaction) {
  return tx.subtype !== "planned" && tx.status === "paid";
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
): MonthlySummary[] {
  const summaries: Record<string, Omit<MonthlySummary, "realEndingBalance" | "projectedEndingBalance">> = {};

  for (const [monthKey, amount] of Object.entries(openingBalances)) {
    if (typeof amount === "number" && Number.isFinite(amount)) {
      ensureSummary(summaries, monthKey, openingBalances);
    }
  }

  for (const tx of transactions) {
    if (tx.status === "cancelled") continue;

    const summary = ensureSummary(summaries, getMonthKeyFromDate(tx.date), openingBalances);

    if (isExecutedTransaction(tx)) {
      summary.hasRealData = true;
      if (tx.type === "income") {
        summary.realIncome += tx.amount;
      } else {
        summary.realExpenses += tx.amount;
      }
      continue;
    }

    if (isPlannedTransaction(tx)) {
      summary.hasPlannedData = true;
      if (tx.type === "income") {
        summary.plannedIncome += tx.amount;
      } else {
        summary.plannedExpenses += tx.amount;
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
    if (getMonthKeyFromDate(tx.date) !== monthKey || tx.status === "cancelled") continue;

    const day = Number(tx.date.slice(-2));
    const delta = tx.type === "income" ? tx.amount : -tx.amount;

    if (isExecutedTransaction(tx)) {
      executedByDay.set(day, (executedByDay.get(day) ?? 0) + delta);
    } else if (isPlannedTransaction(tx)) {
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
