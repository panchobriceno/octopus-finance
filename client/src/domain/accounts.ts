import type { Account, Transaction } from "@shared/schema";
import { isExecutedTransaction, normalizeTransaction } from "@/lib/finance";

export type AccountBalanceBreakdown = {
  account: Account;
  bankBalance: number;
  ledgerDelta: number;
  reconciledBalance: number;
  difference: number;
  income: number;
  expenses: number;
  outgoingTransfers: number;
  incomingTransfers: number;
  creditCardPayments: number;
  legacyIncomingTransfers: number;
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function accountDisplayName(account: Pick<Account, "name" | "bank">) {
  return `${account.name} — ${account.bank}`;
}

export function isActiveAccount(account: Account) {
  return ((account as Account & { isActive?: boolean }).isActive ?? true) === true;
}

export function isCashAccount(account: Account) {
  return isActiveAccount(account) && (account.type === "checking" || account.type === "savings");
}

export function isOperatingCashAccount(account: Account) {
  return isActiveAccount(account) && account.type === "checking";
}

export function accountMatchesWorkspace(account: Account, workspace: string | "all") {
  if (workspace === "all") return true;
  if (workspace === "shared") return account.workspace === "shared";
  return (account.workspace ?? "business") === workspace;
}

function isWorkspaceToken(value: unknown) {
  const normalized = normalizeText(value);
  return normalized === "business" || normalized === "family" || normalized === "dentist" || normalized === "shared";
}

function isLegacyDestinationMatch(transaction: Transaction, account: Account) {
  if (!transaction.destinationWorkspace || isWorkspaceToken(transaction.destinationWorkspace)) return false;

  const destination = normalizeText(transaction.destinationWorkspace);
  const labels = [
    account.id,
    account.name,
    accountDisplayName(account),
    `${account.name} - ${account.bank}`,
    `${account.bank} ${account.name}`,
    `${account.name} ${account.bank}`,
  ].map(normalizeText);

  return labels.includes(destination);
}

export function getAccountBalanceBreakdowns(
  accounts: Account[],
  transactions: Transaction[],
): AccountBalanceBreakdown[] {
  return accounts.map((account) => {
    const breakdown = transactions.reduce<AccountBalanceBreakdown>(
      (acc, transaction) => {
        const normalized = normalizeTransaction(transaction);
        if (normalized.status === "cancelled" || !isExecutedTransaction(normalized)) return acc;

        const amount = toNumber(normalized.amount);
        const isSourceAccount = normalized.accountId === account.id;
        const isDestinationAccount =
          normalized.movementType === "transfer" &&
          ((transaction.destinationAccountId ?? null) === account.id ||
            isLegacyDestinationMatch(transaction, account));

        if (isSourceAccount) {
          if (normalized.movementType === "income") {
            acc.income += amount;
            acc.ledgerDelta += amount;
          } else if (normalized.movementType === "credit_card_payment") {
            acc.creditCardPayments += amount;
            acc.ledgerDelta -= amount;
          } else if (normalized.movementType === "transfer") {
            acc.outgoingTransfers += amount;
            acc.ledgerDelta -= amount;
          } else if (normalized.movementType === "expense" && normalized.paymentMethod !== "credit_card") {
            acc.expenses += amount;
            acc.ledgerDelta -= amount;
          }
        }

        if (isDestinationAccount) {
          acc.incomingTransfers += amount;
          if (!transaction.destinationAccountId) {
            acc.legacyIncomingTransfers += amount;
          }
          acc.ledgerDelta += amount;
        }

        return acc;
      },
      {
        account,
        bankBalance: toNumber(account.currentBalance),
        ledgerDelta: 0,
        reconciledBalance: toNumber(account.currentBalance),
        difference: 0,
        income: 0,
        expenses: 0,
        outgoingTransfers: 0,
        incomingTransfers: 0,
        creditCardPayments: 0,
        legacyIncomingTransfers: 0,
      },
    );

    breakdown.reconciledBalance = breakdown.bankBalance + breakdown.ledgerDelta;
    breakdown.difference = breakdown.reconciledBalance - breakdown.bankBalance;
    return breakdown;
  });
}

export function getAvailableCashBalance(
  accounts: Account[],
  workspace: string | "all" = "all",
) {
  return accounts.reduce((sum, account) => {
    if (!isCashAccount(account) || !accountMatchesWorkspace(account, workspace)) return sum;
    return sum + toNumber(account.currentBalance);
  }, 0);
}

export function getOperatingCashBalance(
  accounts: Account[],
  workspace: string | "all" = "all",
) {
  return accounts.reduce((sum, account) => {
    if (!isOperatingCashAccount(account) || !accountMatchesWorkspace(account, workspace)) return sum;
    return sum + toNumber(account.currentBalance);
  }, 0);
}

export function getSavingsBalance(accounts: Account[], workspace: string | "all" = "all") {
  return accounts.reduce((sum, account) => {
    if (!isActiveAccount(account) || account.type !== "savings" || !accountMatchesWorkspace(account, workspace)) {
      return sum;
    }
    return sum + toNumber(account.currentBalance);
  }, 0);
}
