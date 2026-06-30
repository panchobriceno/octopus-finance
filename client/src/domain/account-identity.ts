/**
 * Identidad canónica de cuentas (Fase 1 del plan de identidad, revisado por Codex).
 * Helper PURO, sin migrar datos. Define la clave estructural y cómo resolver una
 * referencia de tarjeta (cardAccountId / creditCardName) a la cuenta real.
 *
 * Semántica acordada: en una transacción/compromiso, `accountId` = cuenta que PAGA (caja),
 * y `cardAccountId` = la cuenta-tarjeta usada/pagada. No mezclar.
 */
import type { Account } from "@shared/schema";

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Banco canónico (el banco se imprime distinto entre cartolas: Edwards = Banco de Chile). */
export function bankCode(bank: unknown): string {
  const b = norm(bank);
  // Bancos específicos PRIMERO; "chile" al final como catch-all de Edwards/Banco de Chile
  // (si no, "Santander Chile" o "Scotiabank Chile" caerían en bancochile).
  if (b.includes("santander")) return "santander";
  if (b.includes("itau")) return "itau";
  if (b.includes("scotia")) return "scotiabank";
  if (b.includes("falabella")) return "falabella";
  if (b.includes("bci")) return "bci";
  if (b.includes("estado")) return "bancoestado";
  if (b.includes("edward") || b.includes("chile")) return "bancochile";
  return b.replace(/\s+/g, "").slice(0, 14) || "banco";
}

/** Clave de identidad: tarjetas/líneas por last4, cuentas por número completo; fallback a nombre. */
export function accountIdentityKey(a: Pick<Account, "bank" | "type" | "accountNumber" | "name">): string {
  const bc = bankCode(a.bank);
  const d = digits(a.accountNumber);
  if (a.type === "credit_card" || a.type === "credit_line") {
    return d.length >= 4 ? `${bc}:${a.type}:${d.slice(-4)}` : `${bc}:${a.type}:name:${norm(a.name)}`;
  }
  return d ? `${bc}:${a.type}:${d}` : `${bc}:${a.type}:name:${norm(a.name)}`;
}

/** Resuelve una referencia de tarjeta a la cuenta-tarjeta: por cardAccountId → last4 del nombre → nombre (legacy). */
export function resolveCardAccount(
  ref: { cardAccountId?: string | null; creditCardName?: string | null },
  accounts: Account[],
): Account | null {
  if (ref.cardAccountId) {
    const direct = accounts.find((a) => a.id === ref.cardAccountId);
    // solo vale si apunta a una tarjeta; si apunta a otra cosa, no la tratamos como tarjeta
    if (direct && (direct.type === "credit_card" || direct.type === "credit_line")) return direct;
  }
  const cc = ref.creditCardName;
  if (cc) {
    const cards = accounts.filter((a) => a.type === "credit_card");
    const m = String(cc).match(/(\d{4})\s*$/);
    if (m) {
      const byLast4 = cards.filter((a) => digits(a.accountNumber).slice(-4) === m[1] && digits(a.accountNumber).length >= 4);
      if (byLast4.length === 1) return byLast4[0];
    }
    const byName = cards.filter((a) => norm(a.name) === norm(cc));
    if (byName.length === 1) return byName[0];
  }
  return null;
}
