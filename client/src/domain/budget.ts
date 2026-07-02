import type { Transaction } from "@shared/schema";
import {
  getTransactionExpenseImpact,
  isExecutedTransaction,
  normalizeTransaction,
  type WorkspaceFilter,
} from "@/lib/finance";

export function isExecutedBudgetExpenseTransaction(
  transaction: Transaction,
  monthKey: string,
  workspace: WorkspaceFilter,
) {
  const normalized = normalizeTransaction(transaction);

  return (
    normalized.date.startsWith(monthKey) &&
    isExecutedTransaction(normalized) &&
    getTransactionExpenseImpact(normalized, workspace) > 0
  );
}
