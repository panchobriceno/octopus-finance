import { describe, it, expect } from "vitest";
import { bankCode, accountIdentityKey, resolveCardAccount } from "../account-identity";
import type { Account } from "@shared/schema";

function acc(p: Partial<Account> = {}): Account {
  return { id: "a", name: "T.C Edwards Pancho", bank: "Banco Edwards", type: "credit_card", accountNumber: "****7232", currentBalance: 0, currency: "CLP", workspace: "family", isShared: false, notes: null, updatedAt: "", ...p } as Account;
}

describe("bankCode", () => {
  it("canoniza Edwards y Banco de Chile al mismo código", () => {
    expect(bankCode("Banco Edwards")).toBe("bancochile");
    expect(bankCode("Banco de Chile")).toBe("bancochile");
    expect(bankCode("Banco Edward")).toBe("bancochile");
  });
  it("santander e itaú", () => {
    expect(bankCode("Banco Santander")).toBe("santander");
    expect(bankCode("Itaú")).toBe("itau");
  });
});

describe("accountIdentityKey", () => {
  it("tarjeta por last4", () => {
    expect(accountIdentityKey(acc({ type: "credit_card", accountNumber: "****7232" }))).toBe("bancochile:credit_card:7232");
  });
  it("cuenta corriente por número completo", () => {
    expect(accountIdentityKey(acc({ type: "checking", bank: "Banco Santander", accountNumber: "73873991" }))).toBe("santander:checking:73873991");
  });
  it("fallback a nombre si no hay número", () => {
    expect(accountIdentityKey(acc({ type: "credit_card", accountNumber: null, name: "T.C Sin Numero" }))).toBe("bancochile:credit_card:name:t.c sin numero");
  });
});

describe("resolveCardAccount", () => {
  const edw = acc({ id: "edw", name: "T.C Edwards Pancho", accountNumber: "****7232" });
  const javi = acc({ id: "javi", name: "T.C Edwards Signature Javi", accountNumber: "****1449" });
  const accounts = [edw, javi, acc({ id: "cc", type: "checking", accountNumber: "73873991" })];

  it("resuelve por cardAccountId directo", () => {
    expect(resolveCardAccount({ cardAccountId: "javi" }, accounts)?.id).toBe("javi");
  });
  it("resuelve por last4 en el creditCardName", () => {
    expect(resolveCardAccount({ creditCardName: "Banco Edwards …7232" }, accounts)?.id).toBe("edw");
  });
  it("resuelve por nombre exacto (legacy)", () => {
    expect(resolveCardAccount({ creditCardName: "T.C Edwards Pancho" }, accounts)?.id).toBe("edw");
  });
  it("devuelve null si no matchea", () => {
    expect(resolveCardAccount({ creditCardName: "Banco Otro …9999" }, accounts)).toBeNull();
  });
});
