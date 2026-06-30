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
  destinationAccountId?: string | null;
  creditCardName?: string | null;
  installmentCount?: number | null;
  accountId?: string | null;
  sourceClientPaymentId?: string | null;
  sourceCommitmentInstanceId?: string | null;
  sourceCommitmentTemplateId?: string | null;
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
  destinationAccountId?: string | null;
  creditCardName?: string | null;
  installmentCount?: number | null;
  accountId?: string | null;
  sourceClientPaymentId?: string | null;
  sourceCommitmentInstanceId?: string | null;
  sourceCommitmentTemplateId?: string | null;
  importBatchId?: string | null;
  importBatchLabel?: string | null;
  importedAt?: string | null;
}

// ── Client Payments / Ingresos clientes ────────────────────────
export interface ClientPayment {
  id: string;
  clientName: string;
  clientId?: string | null;
  rut: string | null;
  contactName: string | null;
  email: string | null;
  accountManager: string | null;
  serviceItem: string | null;
  serviceMonth: string | null;
  issueDate: string | null;
  dueDate: string | null;
  expectedDate?: string | null;
  paymentDate: string | null;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
  status: string; // "projected" | "receivable" | "invoiced" | "paid" | "cancelled"
  notes: string | null;
  workspace?: string; // business
}

export interface InsertClientPayment {
  clientName: string;
  clientId?: string | null;
  rut?: string | null;
  contactName?: string | null;
  email?: string | null;
  accountManager?: string | null;
  serviceItem?: string | null;
  serviceMonth?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  expectedDate?: string | null;
  paymentDate?: string | null;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
  status: string;
  notes?: string | null;
  workspace?: string;
}

// ── Clients ────────────────────────────────────────────────────
export interface Client {
  id: string;
  name: string;
  rut: string | null;
  contactName: string | null;
  email: string | null;
  accountManager: string | null;
  paymentRisk: string; // "low" | "medium" | "high"
  averageDaysLate: number;
  notes: string | null;
  workspace: string; // "business"
  createdAt: string; // YYYY-MM-DD
  // ── Recurrencia (Fase 1) — un cargo mensual fijo por cliente ──
  monthlyNetAmount: number | null; // null = sin configurar; >0 para recurrente activo
  vatApplies: boolean; // IVA 19% sobre el neto
  serviceItem: string | null; // mismo nombre que ClientPayment.serviceItem
  billingDay: number; // día de facturación (1..28)
  active: boolean; // recurrente activo
  startMonth: string | null; // YYYY-MM desde cuándo factura (opcional)
}

export interface InsertClient {
  name: string;
  rut?: string | null;
  contactName?: string | null;
  email?: string | null;
  accountManager?: string | null;
  paymentRisk?: string;
  averageDaysLate?: number;
  notes?: string | null;
  workspace?: string;
  createdAt?: string;
  monthlyNetAmount?: number | null;
  vatApplies?: boolean;
  serviceItem?: string | null;
  billingDay?: number;
  active?: boolean;
  startMonth?: string | null;
}

// ── Accounts ───────────────────────────────────────────────────
export interface Account {
  id: string;
  name: string;
  bank: string;
  type: string; // "checking" | "savings" | "credit_card" | "credit_line"
  accountNumber: string | null; // número de cuenta (para matchear traspasos por número)
  currentBalance: number;
  currency: string;
  workspace: string; // "business" | "family" | "shared"
  isShared: boolean;
  notes: string | null;
  updatedAt: string;
}

export interface InsertAccount {
  name: string;
  bank: string;
  type: string;
  accountNumber?: string | null;
  currentBalance: number;
  currency?: string;
  workspace?: string;
  isShared?: boolean;
  notes?: string | null;
  updatedAt?: string;
}

// ── Credit Card Settings ──────────────────────────────────────
export interface CreditCardSetting {
  id: string;
  cardName: string;
  defaultPaymentAccountId: string | null;
  workspace: string; // "business" | "family" | "shared"
  isActive: boolean;
}

export interface InsertCreditCardSetting {
  cardName: string;
  defaultPaymentAccountId?: string | null;
  workspace?: string;
  isActive?: boolean;
}

// Consolidado de deuda de una cartola de tarjeta (historial mes a mes). Fuente del Centro de Deuda.
export interface CreditCardStatement {
  id: string;                       // determinístico: `${cardKey}::${statementMonthKey}`
  cardKey: string;                  // canónico: bank|holder|last4
  cardLabel: string;                // legible
  bank: string;
  holder: string;
  last4: string;
  statementMonthKey: string;        // YYYY-MM (de periodEnd)
  paymentMonthKey: string | null;   // YYYY-MM (de pagarHasta)
  periodStart: string | null;       // YYYY-MM-DD
  periodEnd: string;                // YYYY-MM-DD
  pagarHasta: string;               // YYYY-MM-DD
  montoFacturado: number;           // CLP, total nacional a pagar del período actual
  montoMinimo: number | null;
  cupoTotal: number | null;
  cupoUtilizado: number | null;
  cupoDisponible: number | null;
  deudaInternacionalUsd: number | null;
  currency: string;                 // "CLP"
  source: string;                   // "manual_file" | "email"
  sourceFileHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsertCreditCardStatement {
  id?: string;
  cardKey: string;
  cardLabel: string;
  bank: string;
  holder: string;
  last4: string;
  statementMonthKey: string;
  paymentMonthKey?: string | null;
  periodStart?: string | null;
  periodEnd: string;
  pagarHasta: string;
  montoFacturado: number;
  montoMinimo?: number | null;
  cupoTotal?: number | null;
  cupoUtilizado?: number | null;
  cupoDisponible?: number | null;
  deudaInternacionalUsd?: number | null;
  currency?: string;
  source?: string;
  sourceFileHash?: string | null;
  createdAt?: string;
  updatedAt?: string;
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
  isRecurring?: boolean;
  dayOfMonth?: number;
  order?: number;
  isArchived?: boolean;
}

export interface InsertBudget {
  year: number;
  month: number;
  categoryGroup: string;
  amount: number;
  workspace?: string;
  isRecurring?: boolean;
  dayOfMonth?: number;
  order?: number;
  isArchived?: boolean;
}

// ── Opening Balances ────────────────────────────────────────────
export interface OpeningBalance {
  id: string;
  year: number;
  month: number;
  amount: number;
}

// ── Monthly Close / Cierre mensual ─────────────────────────────
export type MonthlyCloseStatus = "closed" | "reopened";

export interface MonthlyCloseChecklistItem {
  id: string;
  label: string;
  detail: string;
  status: "ready" | "warning" | "blocked";
  count?: number;
}

export interface MonthlyCloseSummaryRow {
  id: string;
  label: string;
  budget: number;
  actual: number;
  delta: number;
  deltaPercent: number | null;
}

export interface MonthlyCloseSnapshot {
  id: string;
  monthKey: string;
  year: number;
  month: number;
  status: MonthlyCloseStatus;
  closedAt: string | null;
  reopenedAt?: string | null;
  notes: string | null;
  summary: Record<string, number>;
  checklist: MonthlyCloseChecklistItem[];
  rows: MonthlyCloseSummaryRow[];
  createdAt: string;
  updatedAt: string;
}

export interface InsertMonthlyCloseSnapshot {
  monthKey: string;
  year: number;
  month: number;
  status?: MonthlyCloseStatus;
  closedAt?: string | null;
  reopenedAt?: string | null;
  notes?: string | null;
  summary: Record<string, number>;
  checklist: MonthlyCloseChecklistItem[];
  rows: MonthlyCloseSummaryRow[];
  createdAt?: string;
  updatedAt?: string;
}

// ── Monthly Commitments / Automatizacion mensual ───────────────
export interface CommitmentTemplate {
  id: string;
  name: string;
  category: string;
  amount: number;
  amountMode: string; // "fixed" | "variable"
  workspace: string; // "business" | "family" | "dentist" | "shared"
  movementType: string; // "expense" | "credit_card_payment" | "transfer"
  paymentMethod: string; // "bank_account" | "credit_card" | "cash"
  accountId: string | null;
  destinationAccountId?: string | null;
  creditCardName: string | null;
  dayOfMonth: number;
  frequency: string; // "monthly"
  matchingKeywords: string[];
  amountTolerance: number;
  dateToleranceDays: number;
  sourceBudgetKey?: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsertCommitmentTemplate {
  name: string;
  category: string;
  amount: number;
  amountMode?: string;
  workspace?: string;
  movementType?: string;
  paymentMethod?: string;
  accountId?: string | null;
  destinationAccountId?: string | null;
  creditCardName?: string | null;
  dayOfMonth: number;
  frequency?: string;
  matchingKeywords?: string[];
  amountTolerance?: number;
  dateToleranceDays?: number;
  sourceBudgetKey?: string | null;
  isActive?: boolean;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CommitmentInstance {
  id: string;
  templateId: string;
  monthKey: string; // YYYY-MM
  name: string;
  category: string;
  expectedAmount: number;
  amountMode: string; // "fixed" | "variable"
  dueDate: string; // YYYY-MM-DD
  workspace: string;
  movementType: string;
  paymentMethod: string;
  accountId: string | null;
  destinationAccountId?: string | null;
  creditCardName: string | null;
  status: string; // "pending" | "paid" | "skipped"
  matchedTransactionId: string | null;
  matchedAt: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsertCommitmentInstance {
  templateId: string;
  monthKey: string;
  name: string;
  category: string;
  expectedAmount: number;
  amountMode?: string;
  dueDate: string;
  workspace?: string;
  movementType?: string;
  paymentMethod?: string;
  accountId?: string | null;
  destinationAccountId?: string | null;
  creditCardName?: string | null;
  status?: string;
  matchedTransactionId?: string | null;
  matchedAt?: string | null;
  paidAt?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// ── Bank Import Pipeline / Movimientos crudos ──────────────────
export interface ImportBatch {
  id: string;
  label: string;
  source: string; // "demo" | "manual_file" | "api" | "browser_assistant" | "email"
  sourceName: string;
  sourceType: string; // "bank_account" | "credit_card"
  bankName: string | null;
  accountId: string | null;
  creditCardName: string | null;
  workspace: string; // "business" | "family" | "dentist" | "shared"
  periodStart: string | null;
  periodEnd: string | null;
  rowCount: number;
  totalIncome: number;
  totalExpense: number;
  duplicateCount: number;
  status: string; // "reviewing" | "partially_converted" | "completed" | "closed"
  isDemo: boolean;
  notes: string | null;
  closedAt?: string | null;
  discardedOnRollback?: number;
  createdAt: string;
  updatedAt: string;
}

export interface InsertImportBatch {
  label: string;
  source?: string;
  sourceName: string;
  sourceType: string;
  bankName?: string | null;
  accountId?: string | null;
  creditCardName?: string | null;
  workspace?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  rowCount?: number;
  totalIncome?: number;
  totalExpense?: number;
  duplicateCount?: number;
  status?: string;
  isDemo?: boolean;
  notes?: string | null;
  closedAt?: string | null;
  discardedOnRollback?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImportedMovement {
  id: string;
  batchId: string;
  externalId: string | null;
  dedupeKey: string;
  source: string;
  sourceName: string;
  sourceType: string; // "bank_account" | "credit_card"
  bankName: string | null;
  accountId: string | null;
  creditCardName: string | null;
  date: string;
  description: string;
  rawDescription: string;
  amount: number;
  direction: string; // "income" | "expense"
  currency: string;
  suggestedName: string;
  suggestedCategory: string;
  suggestedWorkspace: string;
  suggestedMovementType: string; // "income" | "expense" | "transfer" | "credit_card_payment"
  suggestedPaymentMethod: string; // "bank_account" | "credit_card" | "cash"
  suggestedDestinationWorkspace: string | null;
  suggestedDestinationAccountId: string | null;
  suggestedSourceAccountId: string | null; // cuenta ORIGEN sugerida para traspasos (no pisa accountId/procedencia)
  installmentCount: number | null;
  confidence: number;
  matchedRuleId: string | null;
  duplicateTransactionId: string | null;
  duplicateMovementId: string | null;
  status: string; // "pending" | "converted" | "reconciled" | "discarded" | "duplicate"
  matchedTransactionId: string | null;
  notes: string | null;
  discardReason?: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  convertedAt: string | null;
  discardedAt: string | null;
}

export interface InsertImportedMovement {
  batchId: string;
  externalId?: string | null;
  dedupeKey: string;
  source?: string;
  sourceName: string;
  sourceType: string;
  bankName?: string | null;
  accountId?: string | null;
  creditCardName?: string | null;
  date: string;
  description: string;
  rawDescription?: string;
  amount: number;
  direction: string;
  currency?: string;
  suggestedName?: string;
  suggestedCategory: string;
  suggestedWorkspace?: string;
  suggestedMovementType: string;
  suggestedPaymentMethod?: string;
  suggestedDestinationWorkspace?: string | null;
  suggestedDestinationAccountId?: string | null;
  suggestedSourceAccountId?: string | null;
  installmentCount?: number | null;
  confidence?: number;
  matchedRuleId?: string | null;
  duplicateTransactionId?: string | null;
  duplicateMovementId?: string | null;
  status?: string;
  matchedTransactionId?: string | null;
  notes?: string | null;
  discardReason?: string | null;
  isDemo?: boolean;
  createdAt?: string;
  updatedAt?: string;
  convertedAt?: string | null;
  discardedAt?: string | null;
}

export interface MovementRule {
  id: string;
  name: string;
  keywords: string[];
  category: string;
  workspace: string;
  movementType: string;
  paymentMethod: string;
  accountId: string | null;
  creditCardName: string | null;
  amountDirection: string; // "any" | "income" | "expense"
  priority: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsertMovementRule {
  name: string;
  keywords?: string[];
  category: string;
  workspace?: string;
  movementType?: string;
  paymentMethod?: string;
  accountId?: string | null;
  creditCardName?: string | null;
  amountDirection?: string;
  priority?: number;
  isActive?: boolean;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
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
  destinationAccountId: z.string().nullable().optional(),
  creditCardName: z.string().nullable().optional(),
  installmentCount: z.number().int().nullable().optional(),
  accountId: z.string().nullable().optional(),
  sourceClientPaymentId: z.string().nullable().optional(),
  sourceCommitmentInstanceId: z.string().nullable().optional(),
  sourceCommitmentTemplateId: z.string().nullable().optional(),
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
  isRecurring: z.boolean().optional(),
  dayOfMonth: z.number().int().optional(),
  order: z.number().int().optional(),
});

export const insertClientPaymentSchema = z.object({
  clientName: z.string().min(1),
  clientId: z.string().nullable().optional(),
  rut: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  accountManager: z.string().nullable().optional(),
  serviceItem: z.string().nullable().optional(),
  serviceMonth: z.string().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  expectedDate: z.string().nullable().optional(),
  paymentDate: z.string().nullable().optional(),
  netAmount: z.number(),
  vatAmount: z.number(),
  totalAmount: z.number(),
  status: z.string().min(1),
  notes: z.string().nullable().optional(),
  workspace: z.string().optional(),
});

export const insertClientSchema = z.object({
  name: z.string().min(1),
  rut: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  accountManager: z.string().nullable().optional(),
  paymentRisk: z.enum(["low", "medium", "high"]).optional(),
  averageDaysLate: z.number().optional(),
  notes: z.string().nullable().optional(),
  workspace: z.string().optional(),
  createdAt: z.string().optional(),
});

export const insertAccountSchema = z.object({
  name: z.string().min(1),
  bank: z.string().min(1),
  type: z.enum(["checking", "savings", "credit_card", "credit_line"]),
  accountNumber: z.string().nullable().optional(),
  currentBalance: z.number(),
  currency: z.string().optional(),
  workspace: z.enum(["business", "family", "shared"]).optional(),
  isShared: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});

export const insertCreditCardSettingSchema = z.object({
  cardName: z.string().min(1),
  defaultPaymentAccountId: z.string().nullable().optional(),
  workspace: z.enum(["business", "family", "shared"]).optional(),
  isActive: z.boolean().optional(),
});

const MONTH_KEY = /^\d{4}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const insertCreditCardStatementSchema = z.object({
  id: z.string().optional(),
  cardKey: z.string().min(1),
  cardLabel: z.string().min(1),
  bank: z.string().min(1),
  holder: z.string().min(1),
  last4: z.string().regex(/^\d{4}$/),
  statementMonthKey: z.string().regex(MONTH_KEY),
  paymentMonthKey: z.string().regex(MONTH_KEY).nullable().optional(),
  periodStart: z.string().regex(ISO_DATE).nullable().optional(),
  periodEnd: z.string().regex(ISO_DATE),
  pagarHasta: z.string().regex(ISO_DATE),
  montoFacturado: z.number(),
  montoMinimo: z.number().nullable().optional(),
  cupoTotal: z.number().nullable().optional(),
  cupoUtilizado: z.number().nullable().optional(),
  cupoDisponible: z.number().nullable().optional(),
  deudaInternacionalUsd: z.number().nullable().optional(),
  currency: z.string().optional(),
  source: z.string().optional(),
  sourceFileHash: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const monthlyCloseChecklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  detail: z.string(),
  status: z.enum(["ready", "warning", "blocked"]),
  count: z.number().optional(),
});

export const monthlyCloseSummaryRowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  budget: z.number(),
  actual: z.number(),
  delta: z.number(),
  deltaPercent: z.number().nullable(),
});

export const insertMonthlyCloseSnapshotSchema = z.object({
  monthKey: z.string().min(7),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  status: z.enum(["closed", "reopened"]).optional(),
  closedAt: z.string().nullable().optional(),
  reopenedAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  summary: z.record(z.string(), z.number()),
  checklist: z.array(monthlyCloseChecklistItemSchema),
  rows: z.array(monthlyCloseSummaryRowSchema),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const insertCommitmentTemplateSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  amount: z.number().min(0),
  amountMode: z.enum(["fixed", "variable"]).optional(),
  workspace: z.enum(["business", "family", "dentist", "shared"]).optional(),
  movementType: z.enum(["expense", "credit_card_payment", "transfer"]).optional(),
  paymentMethod: z.enum(["bank_account", "credit_card", "cash"]).optional(),
  accountId: z.string().nullable().optional(),
  destinationAccountId: z.string().nullable().optional(),
  creditCardName: z.string().nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31),
  frequency: z.enum(["monthly"]).optional(),
  matchingKeywords: z.array(z.string()).optional(),
  amountTolerance: z.number().min(0).optional(),
  dateToleranceDays: z.number().int().min(0).optional(),
  sourceBudgetKey: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const insertCommitmentInstanceSchema = z.object({
  templateId: z.string().min(1),
  monthKey: z.string().min(7),
  name: z.string().min(1),
  category: z.string().min(1),
  expectedAmount: z.number().min(0),
  amountMode: z.enum(["fixed", "variable"]).optional(),
  dueDate: z.string().min(1),
  workspace: z.enum(["business", "family", "dentist", "shared"]).optional(),
  movementType: z.enum(["expense", "credit_card_payment", "transfer"]).optional(),
  paymentMethod: z.enum(["bank_account", "credit_card", "cash"]).optional(),
  accountId: z.string().nullable().optional(),
  destinationAccountId: z.string().nullable().optional(),
  creditCardName: z.string().nullable().optional(),
  status: z.enum(["pending", "paid", "skipped"]).optional(),
  matchedTransactionId: z.string().nullable().optional(),
  matchedAt: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const insertImportBatchSchema = z.object({
  label: z.string().min(1),
  source: z.enum(["demo", "manual_file", "api", "browser_assistant", "email"]).optional(),
  sourceName: z.string().min(1),
  sourceType: z.enum(["bank_account", "credit_card"]),
  bankName: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  creditCardName: z.string().nullable().optional(),
  workspace: z.enum(["business", "family", "dentist", "shared"]).optional(),
  periodStart: z.string().nullable().optional(),
  periodEnd: z.string().nullable().optional(),
  rowCount: z.number().int().min(0).optional(),
  totalIncome: z.number().min(0).optional(),
  totalExpense: z.number().min(0).optional(),
  duplicateCount: z.number().int().min(0).optional(),
  status: z.enum(["reviewing", "partially_converted", "completed", "closed"]).optional(),
  isDemo: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  closedAt: z.string().nullable().optional(),
  discardedOnRollback: z.number().int().min(0).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const insertImportedMovementSchema = z.object({
  batchId: z.string().min(1),
  externalId: z.string().nullable().optional(),
  dedupeKey: z.string().min(1),
  source: z.enum(["demo", "manual_file", "api", "browser_assistant", "email"]).optional(),
  sourceName: z.string().min(1),
  sourceType: z.enum(["bank_account", "credit_card"]),
  bankName: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  creditCardName: z.string().nullable().optional(),
  date: z.string().min(1),
  description: z.string().min(1),
  rawDescription: z.string().optional(),
  amount: z.number().min(0),
  direction: z.enum(["income", "expense"]),
  currency: z.string().optional(),
  suggestedName: z.string().optional(),
  suggestedCategory: z.string().min(1),
  suggestedWorkspace: z.enum(["business", "family", "dentist", "shared"]).optional(),
  suggestedMovementType: z.enum(["income", "expense", "transfer", "credit_card_payment"]),
  suggestedPaymentMethod: z.enum(["bank_account", "credit_card", "cash"]).optional(),
  suggestedDestinationWorkspace: z.string().nullable().optional(),
  suggestedDestinationAccountId: z.string().nullable().optional(),
  suggestedSourceAccountId: z.string().nullable().optional(),
  installmentCount: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(100).optional(),
  matchedRuleId: z.string().nullable().optional(),
  duplicateTransactionId: z.string().nullable().optional(),
  duplicateMovementId: z.string().nullable().optional(),
  status: z.enum(["pending", "converted", "reconciled", "discarded", "duplicate"]).optional(),
  matchedTransactionId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  discardReason: z.enum(["manual", "batch_rollback"]).nullable().optional(),
  isDemo: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  convertedAt: z.string().nullable().optional(),
  discardedAt: z.string().nullable().optional(),
});

export const insertMovementRuleSchema = z.object({
  name: z.string().min(1),
  keywords: z.array(z.string()).optional(),
  category: z.string().min(1),
  workspace: z.enum(["business", "family", "dentist", "shared"]).optional(),
  movementType: z.enum(["income", "expense", "transfer", "credit_card_payment"]).optional(),
  paymentMethod: z.enum(["bank_account", "credit_card", "cash"]).optional(),
  accountId: z.string().nullable().optional(),
  creditCardName: z.string().nullable().optional(),
  amountDirection: z.enum(["any", "income", "expense"]).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
