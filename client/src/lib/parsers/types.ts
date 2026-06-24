import type { Transaction } from "@shared/schema";

export const IMPORT_CONFIDENCE_PENDING = 76;
export const IMPORT_CONFIDENCE_DUPLICATE = 65;

export type AccountType = "bank" | "credit";

export type CcMovementType = "purchase" | "tc_payment" | "reversal";

export interface ParsedPreviewRow {
  id: string;
  date: string;
  name: string;
  amount: number;
  type: "income" | "expense" | "credit_card_payment";
  category: string;
  workspace: "business" | "family" | "dentist";
  installmentsLabel: string;
  installmentCount: number | null;
  duplicate: boolean;
  ccMovementType?: CcMovementType;
  error?: string;
}

export interface ColumnMapping {
  date: string;
  description: string;
  amount: string;
  installments: string;
}

export type ImportWorkspace = ParsedPreviewRow["workspace"];

export type CategoryRef = {
  name: string;
  type: string;
  workspace?: string | null;
};

export type CreditCardPaymentTransaction = Pick<
  Transaction,
  "type" | "movementType" | "status" | "creditCardName" | "amount" | "date" | "accountId" | "id"
>;

export type ClaudePdfMovement = {
  date: string;
  description: string;
  amount: number;
  installments: string;
};

export type ClaudePdfExtraction = {
  payUntil: string;
  movements: ClaudePdfMovement[];
};

export type BankParserId = "credit-card" | "santander" | "edwards" | "itau" | "generic-bank";

export interface BankParserInput {
  fileName: string;
  headers: string[];
  lines: string[];
  accountType: AccountType;
  sourceKind?: "csv" | "pdf";
}

export interface BankParser {
  id: BankParserId;
  label: string;
  sourceName: string;
  bankName?: string | null;
  canHandle(input: BankParserInput): boolean;
  inferMapping?(headers: string[], rows: Record<string, string>[]): ColumnMapping;
}
