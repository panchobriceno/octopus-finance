import { describe, it, expect } from "vitest";
import { buildCashObligations } from "../cash-obligations";
import type { CommitmentInstance, Account } from "@shared/schema";
import type { CardDebt } from "../debt";

const ci = (p: Partial<CommitmentInstance>): CommitmentInstance => ({
  id: "c", templateId: "t", monthKey: "2026-06", name: "X", category: "Digital", expectedAmount: 10000,
  amountMode: "fixed", dueDate: "2026-06-20", workspace: "family", movementType: "expense",
  paymentMethod: "bank_account", accountId: null, destinationAccountId: null, creditCardName: null,
  cardAccountId: null, status: "pending", matchedTransactionId: null, matchedAt: null, paidAt: null,
  notes: null, createdAt: "", updatedAt: "", ...p,
} as CommitmentInstance);

const debt = (p: Partial<CardDebt>): CardDebt => ({
  cardKey: "7232", cardLabel: "Edwards", bank: "Banco Edwards", last4: "7232", statementMonthKey: "2026-06",
  periodEnd: "2026-06-05", pagarHasta: "2026-06-25", montoFacturado: 200000, pagado: 50000, pendienteReal: 150000,
  montoMinimo: null, cupoUtilizado: null, cupoTotal: null, deudaInternacionalUsd: null, pagos: [], vencido: false, history: [], ...p,
});

const asOf = "2026-06-15";

describe("buildCashObligations", () => {
  it("excluye suscripción de tarjeta (cardAccountId) y la cuenta como excluida", () => {
    const r = buildCashObligations({ commitments: [ci({ id: "netflix", cardAccountId: "acc7232", expectedAmount: 13000 })], cardDebts: [], asOf });
    expect(r.obligations.find((o) => o.id === "commitment:netflix")).toBeUndefined();
    expect(r.excluded.cardCommitments).toEqual({ count: 1, sum: 13000 });
  });

  it("excluye placeholder T.C Pancho/Javi", () => {
    const r = buildCashObligations({ commitments: [ci({ id: "ph", category: "T.C Pancho", expectedAmount: 140000 })], cardDebts: [], asOf });
    expect(r.obligations.length).toBe(0);
    expect(r.excluded.placeholders).toEqual({ count: 1, sum: 140000 });
  });

  it("incluye compromiso de caja (banco) dentro de ventana", () => {
    const r = buildCashObligations({ commitments: [ci({ id: "arriendo", category: "Consulta Javi", expectedAmount: 290000, paymentMethod: "bank_account" })], cardDebts: [], asOf });
    expect(r.obligations.find((o) => o.id === "commitment:arriendo")?.amount).toBe(290000);
    expect(r.totals.cash).toBe(290000);
  });

  it("agrega el pago real de la tarjeta (pendienteReal) con metadata", () => {
    const r = buildCashObligations({ commitments: [], cardDebts: [debt({ deudaInternacionalUsd: 651 })], asOf });
    const pay = r.obligations.find((o) => o.kind === "card_payment");
    expect(pay?.amount).toBe(150000);
    expect(pay?.meta?.facturado).toBe(200000);
    expect(pay?.meta?.deudaUsd).toBe(651);
    expect(r.totals.card).toBe(150000);
  });

  it("incluye tarjeta vencida (pagarHasta pasado)", () => {
    const r = buildCashObligations({ commitments: [], cardDebts: [debt({ pagarHasta: "2026-06-01", vencido: true })], asOf });
    expect(r.obligations.find((o) => o.kind === "card_payment")).toBeTruthy();
  });

  it("avisa si una cuenta-tarjeta no tiene estado de cuenta", () => {
    const accounts = [{ id: "a", name: "T.C Sin EECC", bank: "Banco X", type: "credit_card", accountNumber: "****9999" } as Account];
    const r = buildCashObligations({ commitments: [], cardDebts: [], cardAccounts: accounts, asOf });
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("T.C Sin EECC"); // menciona la cuenta
  });

  it("no doble-cuenta: sub de tarjeta excluida + pago real agregado", () => {
    const r = buildCashObligations({
      commitments: [ci({ id: "netflix", cardAccountId: "acc7232", expectedAmount: 13000 }), ci({ id: "ph", category: "T.C Pancho", expectedAmount: 140000 })],
      cardDebts: [debt({})], asOf,
    });
    // total = solo el pago real de la tarjeta (150k), NO 13k+140k+150k
    expect(r.totals.total).toBe(150000);
  });
});
