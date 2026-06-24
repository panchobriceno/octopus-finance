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
  CommitmentTemplate,
  CommitmentInstance,
  InsertMonthlyCloseSnapshot,
  ImportBatch,
  ImportedMovement,
  MovementRule,
  MonthlyCloseSnapshot,
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

export function useMergeDuplicateCategories() {
  return useMutation({
    mutationFn: ({
      primaryCategoryId,
      duplicateCategoryIds,
    }: {
      primaryCategoryId: string;
      duplicateCategoryIds: string[];
    }) => fs.mergeDuplicateCategories(primaryCategoryId, duplicateCategoryIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      queryClient.invalidateQueries({ queryKey: ["commitment-templates"] });
      queryClient.invalidateQueries({ queryKey: ["commitment-instances"] });
      queryClient.invalidateQueries({ queryKey: ["movement-rules"] });
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function useRepairBrokenReferences() {
  return useMutation({
    mutationFn: () => fs.repairBrokenReferences(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
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

export function useGenerateBudgetCommitments() {
  return useMutation({
    mutationFn: (monthKey: string) => fs.generateBudgetCommitmentsForMonth(monthKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commitment-templates"] });
      queryClient.invalidateQueries({ queryKey: ["commitment-instances"] });
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

// ── Monthly Close Snapshots ────────────────────────────────────
export function useMonthlyCloseSnapshots() {
  return useQuery<MonthlyCloseSnapshot[]>({
    queryKey: ["monthly-close-snapshots"],
    queryFn: () => fs.getMonthlyCloseSnapshots(),
  });
}

export function useSaveMonthlyCloseSnapshot() {
  return useMutation({
    mutationFn: (data: InsertMonthlyCloseSnapshot) => fs.saveMonthlyCloseSnapshot(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-close-snapshots"] });
    },
  });
}

export function useReopenMonthlyCloseSnapshot() {
  return useMutation({
    mutationFn: (monthKey: string) => fs.reopenMonthlyCloseSnapshot(monthKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monthly-close-snapshots"] });
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

export function useSyncClientPaymentSettlement() {
  return useMutation({
    mutationFn: ({ payment, accountId }: { payment: ClientPayment; accountId?: string | null }) =>
      fs.syncClientPaymentSettlement(payment, { accountId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["client-payments"] });
    },
  });
}

export function useDeleteClientPayment() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteClientPayment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-payments"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
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

export function useRegularizeClientPayments() {
  return useMutation({
    mutationFn: () => fs.regularizeClientPayments(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-payments"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
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

// ── Commitment Automation ──────────────────────────────────────
export function useCommitmentTemplates() {
  return useQuery<CommitmentTemplate[]>({
    queryKey: ["commitment-templates"],
    queryFn: () => fs.getCommitmentTemplates(),
  });
}

export function useCreateCommitmentTemplate() {
  return useMutation({
    mutationFn: (data: Record<string, any>) => fs.createCommitmentTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commitment-templates"] });
    },
  });
}

export function useUpdateCommitmentTemplate() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateCommitmentTemplate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commitment-templates"] });
    },
  });
}

export function useDeleteCommitmentTemplate() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteCommitmentTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commitment-templates"] });
      queryClient.invalidateQueries({ queryKey: ["commitment-instances"] });
    },
  });
}

export function useCommitmentInstances() {
  return useQuery<CommitmentInstance[]>({
    queryKey: ["commitment-instances"],
    queryFn: () => fs.getCommitmentInstances(),
  });
}

export function useUpdateCommitmentInstance() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateCommitmentInstance(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commitment-instances"] });
    },
  });
}

export function useDeleteCommitmentInstance() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteCommitmentInstance(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commitment-instances"] });
    },
  });
}

export function useGenerateCommitmentInstances() {
  return useMutation({
    mutationFn: (monthKey: string) => fs.generateCommitmentInstances(monthKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commitment-instances"] });
    },
  });
}

export function useBootstrapCommitmentTemplates() {
  return useMutation({
    mutationFn: () => fs.bootstrapCommitmentTemplatesFromRecurringBudgets(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commitment-templates"] });
    },
  });
}

export function useReconcileCommitmentInstances() {
  return useMutation({
    mutationFn: (monthKey: string) => fs.reconcileCommitmentInstances(monthKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commitment-instances"] });
    },
  });
}

// ── Bank Import Pipeline ───────────────────────────────────────
export function useImportBatches() {
  return useQuery<ImportBatch[]>({
    queryKey: ["import-batches"],
    queryFn: () => fs.getImportBatches(),
  });
}

export function useImportedMovements(options: {
  batchId?: string | null;
  status?: string | null;
  limitCount?: number;
  enabled?: boolean;
} = {}) {
  const { enabled = true, ...filters } = options;

  return useQuery<ImportedMovement[]>({
    queryKey: ["imported-movements", filters],
    queryFn: () => fs.getImportedMovements(filters),
    enabled,
  });
}

export function useSeedDemoImportedMovements() {
  return useMutation({
    mutationFn: () => fs.seedDemoImportedMovements(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function useCreateImportedMovementBatch() {
  return useMutation({
    mutationFn: (data: fs.CreateImportedMovementBatchInput) =>
      fs.createImportedMovementBatch(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function useUpdateImportedMovement() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateImportedMovement(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function useDiscardImportedMovement() {
  return useMutation({
    mutationFn: (id: string) => fs.discardImportedMovement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function useConfirmImportedMovementMatch() {
  return useMutation({
    mutationFn: ({ id, transactionId }: { id: string; transactionId: string }) =>
      fs.confirmImportedMovementMatch(id, transactionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function useDeleteImportedMovement() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteImportedMovement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function useRollbackImportBatch() {
  return useMutation({
    mutationFn: (batchId: string) => fs.rollbackImportBatch(batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function useCloseImportBatch() {
  return useMutation({
    mutationFn: (batchId: string) => fs.closeImportBatch(batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function useConvertImportedMovement() {
  return useMutation({
    mutationFn: ({
      id,
      override,
      forceDuplicate,
    }: {
      id: string;
      override?: Parameters<typeof fs.convertImportedMovementToTransaction>[1];
      forceDuplicate?: boolean;
    }) => fs.convertImportedMovementToTransaction(id, override, { forceDuplicate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function useBulkConvertImportedMovements() {
  return useMutation({
    mutationFn: (ids: string[]) => fs.bulkConvertImportedMovements(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["import-batches"] });
      queryClient.invalidateQueries({ queryKey: ["imported-movements"] });
    },
  });
}

export function usePreviewBulkImportedMovementConversion() {
  return useMutation({
    mutationFn: (ids: string[]) => fs.previewBulkImportedMovementConversion(ids),
  });
}

export function useMovementRules() {
  return useQuery<MovementRule[]>({
    queryKey: ["movement-rules"],
    queryFn: () => fs.getMovementRules(),
  });
}

export function useCreateMovementRule() {
  return useMutation({
    mutationFn: (data: Record<string, any>) => fs.createMovementRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["movement-rules"] });
    },
  });
}

export function useUpdateMovementRule() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      fs.updateMovementRule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["movement-rules"] });
    },
  });
}

export function useDeleteMovementRule() {
  return useMutation({
    mutationFn: (id: string) => fs.deleteMovementRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["movement-rules"] });
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
