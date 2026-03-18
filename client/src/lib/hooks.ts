/**
 * React Query hooks backed by Firestore.
 * Each hook encapsulates both the query and mutation logic
 * for a specific collection.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import * as fs from "./firestore";
import type { Transaction, Category, Item, Budget, ClientPayment } from "@shared/schema";

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
