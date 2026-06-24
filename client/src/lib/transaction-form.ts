import type { Transaction } from "@shared/schema";
import { normalizeTransaction } from "@/lib/finance";

export type TransactionFormData = {
  categoryId: string;
  itemId: string;
  amount: string;
  date: string;
  subtype: "actual" | "planned";
  status: "pending" | "paid" | "cancelled";
  workspace: "business" | "family" | "dentist";
  movementType: "income" | "expense" | "transfer" | "credit_card_payment";
  paymentMethod: "cash" | "bank_account" | "credit_card";
  accountId: string;
  destinationWorkspace: "business" | "family" | "dentist";
  creditCardName: string;
  installmentCount: string;
  notes: string;
};

type NamedMaps = {
  categoryMap: Record<string, { name: string } | undefined>;
  itemMap: Record<string, { name: string } | undefined>;
};

function workspaceLabel(workspace: "business" | "family" | "dentist") {
  if (workspace === "business") return "Empresa";
  if (workspace === "family") return "Familia";
  return "Consulta Dentista";
}

/**
 * Transformación pura form -> payload de transacción.
 *
 * Es exactamente la lógica que vivía inline en overview.handleCreate/handleEdit,
 * extraída para reutilizar en la pantalla de Movimientos sin duplicar. NO hace
 * efectos (no toasts, no mutaciones): devuelve { ok, message, payload }. El
 * caller decide validar (crear) o no (editar conserva su comportamiento previo).
 */
export function buildTransactionPayload(
  formData: TransactionFormData,
  maps: NamedMaps,
): { ok: boolean; message: string | null; payload: Record<string, unknown> } {
  const selectedCategory = formData.categoryId ? maps.categoryMap[formData.categoryId] : null;
  const selectedItem = formData.itemId ? maps.itemMap[formData.itemId] : null;
  const derivedName =
    formData.movementType === "transfer"
      ? `Transferencia ${workspaceLabel(formData.workspace)} -> ${workspaceLabel(formData.destinationWorkspace)}`
      : formData.movementType === "credit_card_payment"
        ? `Pago ${formData.creditCardName || "Tarjeta"}`
        : selectedItem?.name ?? selectedCategory?.name ?? "";
  const derivedCategory =
    formData.movementType === "transfer"
      ? "Transferencias"
      : formData.movementType === "credit_card_payment"
        ? "Pago Tarjeta"
        : selectedCategory?.name ?? "";

  const payload = {
    name: derivedName,
    category: derivedCategory,
    amount: parseFloat(formData.amount),
    type: formData.movementType === "income" ? "income" : "expense",
    date: formData.date,
    notes: formData.notes || null,
    subtype: formData.subtype,
    status: formData.status,
    itemId: formData.itemId || null,
    workspace: formData.workspace,
    movementType: formData.movementType,
    paymentMethod: formData.paymentMethod,
    accountId:
      formData.paymentMethod === "bank_account" && formData.movementType !== "transfer"
        ? formData.accountId || null
        : null,
    destinationWorkspace: formData.movementType === "transfer" ? formData.destinationWorkspace : null,
    destinationAccountId: null,
    creditCardName:
      formData.paymentMethod === "credit_card" || formData.movementType === "credit_card_payment"
        ? formData.creditCardName || null
        : null,
    installmentCount:
      formData.paymentMethod === "credit_card" && formData.movementType === "expense"
        ? Number.parseInt(formData.installmentCount || "1", 10)
        : null,
  };

  const ok = Boolean(derivedName && derivedCategory);
  return {
    ok,
    message: ok ? null : "Revisa categoría, subcategoría o tipo de movimiento.",
    payload,
  };
}

/** Transacción -> valores iniciales del form (antes era getEditValues en overview). */
export function getTransactionFormInitialValues(
  tx: Transaction,
  categoryNameToId: Record<string, string>,
): TransactionFormData {
  const normalized = normalizeTransaction(tx);
  return {
    categoryId: categoryNameToId[tx.category] ?? "",
    itemId: tx.itemId ?? "",
    amount: String(tx.amount),
    date: tx.date,
    subtype: tx.subtype as "actual" | "planned",
    status: tx.status as "pending" | "paid" | "cancelled",
    workspace: normalized.workspace as "business" | "family" | "dentist",
    movementType: normalized.movementType as TransactionFormData["movementType"],
    paymentMethod: normalized.paymentMethod as TransactionFormData["paymentMethod"],
    accountId: tx.accountId ?? "",
    destinationWorkspace: (normalized.destinationWorkspace ??
      (normalized.workspace === "business" ? "family" : "business")) as "business" | "family" | "dentist",
    creditCardName: normalized.creditCardName ?? "",
    installmentCount: String(tx.installmentCount ?? 1),
    notes: tx.notes ?? "",
  };
}
