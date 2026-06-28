/**
 * Parser de movimientos de Banco Edwards -> semillas para la app.
 * Puro: no toca red ni Firestore. Usado por edwards-dry-run.ts y load-edwards.ts.
 *
 * Los datos crudos de abajo fueron capturados manualmente el 2026-06-28 durante la
 * prueba. Cuando exista el scraper (Etapa 3), esta capa recibira las filas leidas en
 * vivo y aplicara exactamente el mismo parseo/clasificacion.
 */

import type { MovementSeedInput } from "../../client/src/domain/bank-imports";

export type SeedNoBatch = Omit<MovementSeedInput, "batchId">;

export type ParseResult = {
  checking: SeedNoBatch[];
  card: SeedNoBatch[];
  skipped: { source: string; date: string; desc: string; reason: string }[];
  issues: string[];
};

// ----------------------------- Parsers base -----------------------------

export function parseClp(text: string): number | null {
  const cleaned = String(text ?? "")
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(/\s/g, "")
    .replace(/,/g, ".");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDateCl(text: string): string | null {
  const m = String(text ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  const dd = d.padStart(2, "0");
  const mm = mo.padStart(2, "0");
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return `${year}-${mm}-${dd}`;
}

export function parseInstallments(text: string): number | null {
  const m = String(text ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const total = Number(m[2]);
  return Number.isFinite(total) && total > 1 ? total : null;
}

const CARD_PAYMENT_RE = /monto cancelado|pago pesos|pago normal|^pagos?$|abono/i;

// ----------------------------- Datos capturados (2026-06-28) -----------------------------

const CHECKING_RAW = [
  { date: "26/06/2026", desc: "Transferencia Desde Linea De Credito", amount: "$ 15.858", dir: "income" },
  { date: "26/06/2026", desc: "Pago:sociedad Bravo Pa", amount: "$ 6.000", dir: "expense" },
  { date: "26/06/2026", desc: "Pago:bravo Sport", amount: "$ 2.000", dir: "expense" },
  { date: "26/06/2026", desc: "Pago:aramco", amount: "$ 20.000", dir: "expense" },
  { date: "25/06/2026", desc: "Comision Admin. Mensual Plan Cuenta Corriente", amount: "$ 9.328", dir: "expense" },
  { date: "23/06/2026", desc: "Pago Linea De Cred:013101077707", amount: "$ 300.000", dir: "expense" },
  { date: "23/06/2026", desc: "Cargo Por Pago Tc", amount: "$ 1.520.000", dir: "expense" },
  { date: "23/06/2026", desc: "Pago:proveedores 0968567802", amount: "$ 39.077", dir: "expense" },
  { date: "23/06/2026", desc: "Pago:sb 638", amount: "$ 41.788", dir: "expense" },
  { date: "23/06/2026", desc: "Pago:cl103005 - Asocia", amount: "$ 1.800", dir: "expense" },
];

const CARD_UNBILLED_RAW = [
  { date: "26/06/2026", desc: "DECATHLON CONCEPCION", cuotas: "01/01", cargo: "$ 136.000", pago: "" },
  { date: "26/06/2026", desc: "UBER", cuotas: "01/01", cargo: "$ 3.990", pago: "" },
  { date: "26/06/2026", desc: "PAYU UBER EATS", cuotas: "01/01", cargo: "$ 746", pago: "" },
  { date: "26/06/2026", desc: "PAYU UBER EATS", cuotas: "01/01", cargo: "$ 91.581", pago: "" },
  { date: "24/06/2026", desc: "PAYU *UBER EATS COMPRAS", cuotas: "01/01", cargo: "$ 27.205", pago: "" },
  { date: "24/06/2026", desc: "MP *DECATHLON N CUO COM MARC", cuotas: "01/06", cargo: "$ 320.000", pago: "" },
  { date: "23/06/2026", desc: "MERCADOPAGO*BASAJAUNSPACOMPRAS", cuotas: "01/01", cargo: "$ 26.100", pago: "" },
  { date: "23/06/2026", desc: "PAGO PESOS TEF PAGO NORMAL", cuotas: "01/01", cargo: "", pago: "$ 1.520.000" },
];

const CARD_BILLED_RAW = [
  { date: "22/05/2026", desc: "MONTO CANCELADO", cuotas: "01/01", cargo: "", pago: "$ 2.538.806" },
  { date: "20/05/2026", desc: "AGENDA PRO 2 AGEN** LAS CONDES", cuotas: "01/01", cargo: "$ 35.581", pago: "" },
  { date: "20/05/2026", desc: "AMAZON PRIME LAS CONDES", cuotas: "01/01", cargo: "$ 6.490", pago: "" },
  { date: "21/05/2026", desc: "PAYU *UBER EATS SANTIAGO", cuotas: "01/01", cargo: "$ 2.711", pago: "" },
  { date: "27/05/2026", desc: "KUSHKISEGUROS ** SANTIAGO", cuotas: "01/01", cargo: "$ 39.643", pago: "" },
  { date: "09/06/2026", desc: "COLMENA SANTIAGO", cuotas: "01/01", cargo: "$ 22.013", pago: "" },
];

const NOW = "2026-06-28T00:00:00.000Z";

export function buildEdwardsSeeds(): ParseResult {
  const checking: SeedNoBatch[] = [];
  const card: SeedNoBatch[] = [];
  const skipped: ParseResult["skipped"] = [];
  const issues: string[] = [];

  for (const row of CHECKING_RAW) {
    const date = parseDateCl(row.date);
    const amount = parseClp(row.amount);
    if (!date) { issues.push(`CC fecha invalida: ${row.date} (${row.desc})`); continue; }
    if (amount === null) { issues.push(`CC monto invalido: ${row.amount} (${row.desc})`); continue; }
    const isCardPayment = /cargo por pago tc/i.test(row.desc);
    const movementType = isCardPayment ? "credit_card_payment" : row.dir === "income" ? "income" : "expense";
    checking.push({
      source: "browser_assistant",
      sourceName: "Edwards Cuenta Corriente 00-310-10777-06",
      sourceType: "bank_account",
      bankName: "Banco Edwards",
      date,
      description: row.desc,
      amount: Math.abs(amount),
      direction: row.dir as "income" | "expense",
      category: "",
      workspace: "business",
      movementType: movementType as MovementSeedInput["movementType"],
      paymentMethod: "bank_account",
      createdAt: NOW,
    });
  }

  const handleCard = (rows: typeof CARD_UNBILLED_RAW, label: string) => {
    for (const row of rows) {
      const date = parseDateCl(row.date);
      if (!date) { issues.push(`${label} fecha invalida: ${row.date} (${row.desc})`); continue; }
      const isPayment = !!row.pago || CARD_PAYMENT_RE.test(row.desc);
      if (isPayment) {
        skipped.push({ source: label, date: row.date, desc: row.desc, reason: "pago de tarjeta (ya viene de la cuenta corriente)" });
        continue;
      }
      const amount = parseClp(row.cargo);
      if (amount === null) { issues.push(`${label} monto invalido: '${row.cargo}' (${row.desc})`); continue; }
      card.push({
        source: "browser_assistant",
        sourceName: "Edwards Tarjeta ****7232",
        sourceType: "credit_card",
        creditCardName: "Edwards Visa ****7232",
        date,
        description: row.desc,
        amount: Math.abs(amount),
        direction: "expense",
        category: "",
        workspace: "business",
        movementType: "expense",
        paymentMethod: "credit_card",
        installmentCount: parseInstallments(row.cuotas),
        createdAt: NOW,
      });
    }
  };

  handleCard(CARD_UNBILLED_RAW, "Tarjeta (no facturados)");
  handleCard(CARD_BILLED_RAW, "Tarjeta (facturados)");

  return { checking, card, skipped, issues };
}
