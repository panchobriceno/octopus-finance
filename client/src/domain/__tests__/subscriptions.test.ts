import { describe, it, expect } from "vitest";
import { buildSubscriptions, subTipo } from "../subscriptions";
import type { CommitmentTemplate } from "@shared/schema";

function tpl(p: Partial<CommitmentTemplate> = {}): CommitmentTemplate {
  return {
    id: "x", name: "Sub", category: "Software Empresa", amount: 10000, amountMode: "fixed",
    workspace: "business", movementType: "expense", paymentMethod: "bank_account", accountId: null,
    destinationAccountId: null, creditCardName: null, dayOfMonth: 1, frequency: "monthly",
    matchingKeywords: [], amountTolerance: 0, dateToleranceDays: 0, isActive: true, notes: null,
    createdAt: "", updatedAt: "", ...p,
  } as CommitmentTemplate;
}

describe("buildSubscriptions", () => {
  it("suma total y filtra solo categorías de suscripción", () => {
    const r = buildSubscriptions([
      tpl({ name: "Claude", amount: 110000, category: "Software Empresa" }),
      tpl({ name: "Netflix", amount: 13000, category: "Digital", workspace: "family" }),
      tpl({ name: "Arriendo", amount: 500000, category: "Arriendo" }),
    ]);
    expect(r.items.length).toBe(2);
    expect(r.totalMes).toBe(123000);
    expect(r.totalAnual).toBe(123000 * 12);
  });

  it("detecta overlap de IA (Claude + ChatGPT)", () => {
    const r = buildSubscriptions([
      tpl({ name: "Claude", amount: 110000 }),
      tpl({ name: "Chat GPT", amount: 109000 }),
    ]);
    const ia = r.overlaps.find((o) => o.tipo === "IA");
    expect(ia).toBeTruthy();
    expect(ia!.sum).toBe(219000);
    expect(ia!.items.length).toBe(2);
  });

  it("Apple gana sobre Streaming (Apple TV → Apple)", () => {
    expect(subTipo("Apple TV")).toBe("Apple");
    expect(subTipo("Apple One")).toBe("Apple");
    expect(subTipo("Netflix")).toBe("Streaming");
    expect(subTipo("Claude")).toBe("IA");
    expect(subTipo("Adobe Creative Cloud")).toBe("Diseño");
  });

  it("excluye compromisos que no son gasto (credit_card_payment) e inactivos", () => {
    const r = buildSubscriptions([
      tpl({ name: "Pago TC", category: "Software Empresa", movementType: "credit_card_payment", amount: 50000 }),
      tpl({ name: "Claude", isActive: false }),
    ]);
    expect(r.items.length).toBe(0);
  });
});
