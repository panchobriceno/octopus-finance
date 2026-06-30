import { describe, it, expect } from "vitest";
import { buildCardDebt } from "../debt";
import type { CreditCardStatement, Transaction, Account } from "@shared/schema";

const asOf = "2026-06-30";

function stmt(p: Partial<CreditCardStatement> = {}): CreditCardStatement {
  return {
    id: "banco edwards|pancho|7232::2026-06",
    cardKey: "banco edwards|pancho|7232",
    cardLabel: "Banco Edwards · Pancho …7232",
    bank: "Banco Edwards",
    holder: "Pancho",
    last4: "7232",
    statementMonthKey: "2026-06",
    paymentMonthKey: "2026-07",
    periodStart: "2026-05-21",
    periodEnd: "2026-06-22",
    pagarHasta: "2026-07-08",
    montoFacturado: 3_435_877,
    montoMinimo: 235_186,
    cupoTotal: 5_720_000,
    cupoUtilizado: 5_329_415,
    cupoDisponible: 390_585,
    deudaInternacionalUsd: 0,
    currency: "CLP",
    source: "manual_file",
    sourceFileHash: null,
    createdAt: "",
    updatedAt: "",
    ...p,
  };
}
function card(p: Partial<Account> = {}): Account {
  return { id: "cardacc", name: "T.C Edwards Pancho", bank: "Banco Edwards", type: "credit_card", accountNumber: "****7232", currentBalance: 0, currency: "CLP", workspace: "family", isShared: false, notes: null, updatedAt: "", ...p };
}
function pay(p: Partial<Transaction> = {}): Transaction {
  return {
    id: "p1", name: "Cargo Por Pago Tc", category: "Pago tarjeta", amount: 1_520_000,
    type: "expense", date: "2026-06-23", notes: null, subtype: "actual", status: "paid", itemId: null,
    workspace: "family", movementType: "credit_card_payment", paymentMethod: "bank_account",
    destinationWorkspace: null, destinationAccountId: null, creditCardName: "T.C Edwards Pancho",
    installmentCount: null, accountId: null, sourceClientPaymentId: null,
    importBatchId: null, importBatchLabel: null, importedAt: null,
    ...p,
  } as Transaction;
}

describe("buildCardDebt — neteo de pagos post-cierre", () => {
  it("pago ejecutado después del cierre NETEA y baja la deuda real", () => {
    const [d] = buildCardDebt([stmt()], [pay()], [card()], { asOf });
    expect(d.pagado).toBe(1_520_000);
    expect(d.pendienteReal).toBe(3_435_877 - 1_520_000); // 1.915.877 (vía cuenta-tarjeta por nombre)
  });

  it("pago ANTES del cierre NO cuenta", () => {
    const [d] = buildCardDebt([stmt()], [pay({ date: "2026-06-10" })], [card()], { asOf });
    expect(d.pagado).toBe(0);
    expect(d.pendienteReal).toBe(3_435_877);
  });

  it("pago PLANIFICADO (subtype planned) NO cuenta", () => {
    const [d] = buildCardDebt([stmt()], [pay({ subtype: "planned" })], [card()], { asOf });
    expect(d.pagado).toBe(0);
  });

  it("pago FUTURO (> asOf) NO cuenta", () => {
    const [d] = buildCardDebt([stmt()], [pay({ date: "2026-07-05" })], [card()], { asOf });
    expect(d.pagado).toBe(0);
  });

  it("pago sin last4 en el nombre y sin cuenta-tarjeta -> no netea (muestra facturado)", () => {
    const [d] = buildCardDebt([stmt()], [pay()], [], { asOf });
    expect(d.pagado).toBe(0);
    expect(d.pendienteReal).toBe(3_435_877);
  });

  it("netea por last4 en el nombre del pago (sin cuenta-tarjeta)", () => {
    const [d] = buildCardDebt([stmt()], [pay({ creditCardName: "Tarjeta …7232" })], [], { asOf });
    expect(d.pagado).toBe(1_520_000);
  });

  it("nombre con dígitos internos (T.C 2024 Visa) sin cuenta NO netea (no agarra 2024)", () => {
    const [d] = buildCardDebt([stmt()], [pay({ creditCardName: "T.C 2024 Visa" })], [], { asOf });
    expect(d.pagado).toBe(0);
  });

  it("pago de OTRA tarjeta (last4 distinto) NO cuenta", () => {
    const [d] = buildCardDebt([stmt()], [pay({ creditCardName: "Tarjeta …9999" })], [card()], { asOf });
    expect(d.pagado).toBe(0);
  });

  it("toma el ÚLTIMO estado: el pago de junio ya no cuenta contra el estado de julio", () => {
    const jun = stmt();
    const jul = stmt({ id: "x::2026-07", statementMonthKey: "2026-07", periodEnd: "2026-07-22", pagarHasta: "2026-08-08", montoFacturado: 1_000_000 });
    const [d] = buildCardDebt([jun, jul], [pay({ date: "2026-06-23" })], [card()], { asOf: "2026-07-30" });
    expect(d.statementMonthKey).toBe("2026-07");
    expect(d.pagado).toBe(0); // el pago del 23/06 es anterior al cierre de julio
    expect(d.pendienteReal).toBe(1_000_000);
    expect(d.history).toHaveLength(2);
  });

  it("marca vencido si pagarHasta ya pasó", () => {
    const [d] = buildCardDebt([stmt({ pagarHasta: "2026-06-08" })], [], [card()], { asOf });
    expect(d.vencido).toBe(true);
  });
});
