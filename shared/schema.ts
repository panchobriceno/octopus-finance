/**
 * Shared type definitions for the finance dashboard.
 * No longer depends on drizzle-orm — these are plain TypeScript types
 * matching the Firestore document structure.
 */

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
}

export interface InsertCategory {
  name: string;
  type: string;
  color?: string | null;
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
}

export interface InsertBudget {
  year: number;
  month: number;
  categoryGroup: string;
  amount: number;
}

// ── Opening Balances ────────────────────────────────────────────
export interface OpeningBalance {
  id: string;
  year: number;
  month: number;
  amount: number;
}
