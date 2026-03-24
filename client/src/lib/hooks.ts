/**
 * React Query hooks backed by Firestore.
 * Each hook encapsulates both the query and mutation logic
 * for a specific collection.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import * as fs from "./firestore";
import type {
  Transaction,
  Category,
  Item,
  Budget,
  ClientPayment,
  Client,
  Account,
  CreditCardSetting,
  OpeningBalance,
} from "@shared/schema";

// ── Transactions ────────────────────────────────────────────────
export function useTransactions() {
  return useQuery<Transaction[]>({
    queryKey: ["transactions"],
    queryFn: () => fs.getTransactions(),
  });
}

export function useCreateTransaction() {
  return useMutation({
    mutationFn: (data: Record<string, any>) => fs.createTransaction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useUpdateTransaction() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateTransaction(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useDeleteTransaction() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useBulkDeleteTransactions() {
  return useMutation({
    mutationFn: (ids: string[]) => fs.bulkDeleteTransactions(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useBulkCreateTransactions() {
  return useMutation({
    mutationFn: (rows: Record<string, any>[]) => fs.bulkCreateTransactions(rows),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

// ── Categories ──────────────────────────────────────────────────
export function useCategories() {
  return useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => fs.getCategories(),
  });
}

export function useCreateCategory() {
  return useMutation({
    mutationFn: (data: Record<string, any>) => fs.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export function useUpdateCategory() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export function useDeleteCategory() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

// ── Items ───────────────────────────────────────────────────────
export function useItems() {
  return useQuery<Item[]>({
    queryKey: ["items"],
    queryFn: () => fs.getItems(),
  });
}

export function useCreateItem() {
  return useMutation({
    mutationFn: (data: Record<string, any>) => fs.createItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

export function useUpdateItem() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

export function useDeleteItem() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

// ── Budgets ─────────────────────────────────────────────────────
export function useBudgets() {
  return useQuery<Budget[]>({
    queryKey: ["budgets"],
    queryFn: () => fs.getBudgets(),
  });
}

export function useCreateBudget() {
  return useMutation({
    mutationFn: (data: Record<string, any>) => fs.createBudget(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useUpdateBudget() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateBudget(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useDeleteBudget() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteBudget(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useGenerateMonthlyRecurringTransactions() {
  return useMutation({
    mutationFn: ({ year, month, workspace }: { year: number; month: number; workspace: string }) =>
      fs.generateMonthlyRecurringTransactions(year, month, workspace),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

// ── Opening Balances ───────────────────────────────────────────
export function useOpeningBalances() {
  return useQuery<OpeningBalance[]>({
    queryKey: ["opening-balances"],
    queryFn: () => fs.listOpeningBalances(),
  });
}

export function useSetOpeningBalance() {
  return useMutation({
    mutationFn: ({ monthKey, amount }: { monthKey: string; amount: number }) =>
      fs.setOpeningBalance(monthKey, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opening-balances"] });
    },
  });
}

// ── Client Payments ────────────────────────────────────────────
export function useClientPayments() {
  return useQuery<ClientPayment[]>({
    queryKey: ["client-payments"],
    queryFn: () => fs.getClientPayments(),
  });
}

export function useCreateClientPayment() {
  return useMutation({
    mutationFn: (data: Record<string, any>) => fs.createClientPayment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-payments"] });
    },
  });
}

export function useUpdateClientPayment() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateClientPayment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-payments"] });
    },
  });
}

export function useDeleteClientPayment() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteClientPayment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-payments"] });
    },
  });
}

export function useMigrateClientPaymentStatuses() {
  return useMutation({
    mutationFn: () => fs.migrateClientPaymentStatuses(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-payments"] });
    },
  });
}

// ── Clients ────────────────────────────────────────────────────
export function useClients() {
  return useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => fs.getClients(),
  });
}

export function useCreateClient() {
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      fs.createClient({
        paymentRisk: "low",
        averageDaysLate: 0,
        workspace: "business",
        ...data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}

export function useUpdateClient() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateClient(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}

export function useDeleteClient() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}

// ── Accounts ───────────────────────────────────────────────────
export function useAccounts() {
  return useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => fs.getAccounts(),
  });
}

export function useCreateAccount() {
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      fs.createAccount({
        currency: "CLP",
        workspace: "business",
        isShared: false,
        ...data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useUpdateAccount() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateAccount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

// ── Credit Card Settings ──────────────────────────────────────
export function useCreditCardSettings() {
  return useQuery<CreditCardSetting[]>({
    queryKey: ["credit-card-settings"],
    queryFn: () => fs.getCreditCardSettings(),
  });
}

export function useCreateCreditCardSetting() {
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      fs.createCreditCardSetting({
        defaultPaymentAccountId: null,
        workspace: "family",
        isActive: true,
        ...data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-card-settings"] });
    },
  });
}

export function useUpdateCreditCardSetting() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateCreditCardSetting(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-card-settings"] });
    },
  });
}

export function useDeleteCreditCardSetting() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteCreditCardSetting(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-card-settings"] });
    },
  });
}

// ── Dashboard Preferences ──────────────────────────────────────
export function useDashboardPreferences() {
  return useQuery<{ cardOrder?: string[]; hiddenCards?: string[] } | null>({
    queryKey: ["dashboard-preferences"],
    queryFn: () => fs.getDashboardPreferences(),
  });
}

export function useUpdateDashboardPreferences() {
  return useMutation({
    mutationFn: (data: { cardOrder: string[]; hiddenCards: string[] }) =>
      fs.updateDashboardPreferences(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-preferences"] });
    },
  });
}
