/**
 * Shared type definitions for the finance dashboard.
 * No longer depends on drizzle-orm — these are plain TypeScript types
 * matching the Firestore document structure.
 */
import { z } from "zod";

// ── Transactions ────────────────────────────────────────────────
export interface Transaction {
  id: string;
  name: string;
  category: string;
  amount: number;
  type: string; // "income" | "expense"
  date: string; // YYYY-MM-DD
  notes: string | null;
  subtype: string; // "actual" | "planned"
  status: string; // "pending" | "paid" | "cancelled"
  itemId: string | null;
  workspace?: string; // "business" | "family"
  movementType?: string; // "income" | "expense" | "transfer" | "credit_card_payment"
  paymentMethod?: string; // "cash" | "bank_account" | "credit_card"
  destinationWorkspace?: string | null;
  creditCardName?: string | null;
  installmentCount?: number | null;
  importBatchId?: string | null;
  importBatchLabel?: string | null;
  importedAt?: string | null;
}

export interface InsertTransaction {
  name: string;
  category: string;
  amount: number;
  type: string;
  date: string;
  notes?: string | null;
  subtype?: string;
  status?: string;
  itemId?: string | null;
  workspace?: string;
  movementType?: string;
  paymentMethod?: string;
  destinationWorkspace?: string | null;
  creditCardName?: string | null;
  installmentCount?: number | null;
  importBatchId?: string | null;
  importBatchLabel?: string | null;
  importedAt?: string | null;
}

// ── Client Payments / Ingresos clientes ────────────────────────
export interface ClientPayment {
  id: string;
  clientName: string;
  rut: string | null;
  contactName: string | null;
  email: string | null;
  accountManager: string | null;
  serviceItem: string | null;
  serviceMonth: string | null;
  issueDate: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
  status: string; // "projected" | "receivable" | "paid" | "cancelled"
  notes: string | null;
  workspace?: string; // business
}

export interface InsertClientPayment {
  clientName: string;
  rut?: string | null;
  contactName?: string | null;
  email?: string | null;
  accountManager?: string | null;
  serviceItem?: string | null;
  serviceMonth?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  paymentDate?: string | null;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
  status: string;
  notes?: string | null;
  workspace?: string;
}

// ── Categories ──────────────────────────────────────────────────
export interface Category {
  id: string;
  name: string;
  type: string; // "income" | "expense"
  color: string | null;
  workspace?: string | null; // "business" | "family"
}

export interface InsertCategory {
  name: string;
  type: string;
  color?: string | null;
  workspace?: string | null;
}

// ── Items (subcategories) ───────────────────────────────────────
export interface Item {
  id: string;
  name: string;
  categoryId: string | null;
}

export interface InsertItem {
  name: string;
  categoryId?: string | null;
}

// ── Budgets ─────────────────────────────────────────────────────
export interface Budget {
  id: string;
  year: number;
  month: number; // 1-12
  categoryGroup: string;
  amount: number;
  workspace?: string; // "business" | "family"
}

export interface InsertBudget {
  year: number;
  month: number;
  categoryGroup: string;
  amount: number;
  workspace?: string;
}

// ── Opening Balances ────────────────────────────────────────────
export interface OpeningBalance {
  id: string;
  year: number;
  month: number;
  amount: number;
}

// ── Runtime schemas for legacy Express routes ──────────────────
export const insertTransactionSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  amount: z.number(),
  type: z.string().min(1),
  date: z.string().min(1),
  notes: z.string().nullable().optional(),
  subtype: z.string().optional(),
  status: z.string().optional(),
  itemId: z.string().nullable().optional(),
  workspace: z.string().optional(),
  movementType: z.string().optional(),
  paymentMethod: z.string().optional(),
  destinationWorkspace: z.string().nullable().optional(),
  creditCardName: z.string().nullable().optional(),
  installmentCount: z.number().int().nullable().optional(),
  importBatchId: z.string().nullable().optional(),
  importBatchLabel: z.string().nullable().optional(),
  importedAt: z.string().nullable().optional(),
});

export const insertCategorySchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  color: z.string().nullable().optional(),
  workspace: z.string().nullable().optional(),
});

export const insertItemSchema = z.object({
  name: z.string().min(1),
  categoryId: z.string().nullable().optional(),
});

export const insertBudgetSchema = z.object({
  year: z.number().int(),
  month: z.number().int(),
  categoryGroup: z.string().min(1),
  amount: z.number(),
  workspace: z.string().optional(),
});

export const insertClientPaymentSchema = z.object({
  clientName: z.string().min(1),
  rut: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  accountManager: z.string().nullable().optional(),
  serviceItem: z.string().nullable().optional(),
  serviceMonth: z.string().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  paymentDate: z.string().nullable().optional(),
  netAmount: z.number(),
  vatAmount: z.number(),
  totalAmount: z.number(),
  status: z.string().min(1),
  notes: z.string().nullable().optional(),
  workspace: z.string().optional(),
});
