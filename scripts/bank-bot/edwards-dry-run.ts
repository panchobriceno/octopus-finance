/**
 * Etapa 1 — Parser + prueba en seco (Edwards).
 *
 * Convierte filas crudas de movimientos (capturadas manualmente el 2026-06-28)
 * al formato de la app (ImportedMovement) reusando los ayudantes reales del repo.
 * NO toca Firestore. NO programa nada. Solo imprime para revisión visual.
 *
 * Correr:  npx tsx scripts/bank-bot/edwards-dry-run.ts
 *
 * Decisiones de Codex incorporadas:
 *  - id de documento DETERMINISTICO derivado del dedupeKey (re-cargar pisa, no duplica).
 *  - pagos de tarjeta se OMITEN del lado tarjeta (ya entran desde la cuenta corriente)
 *    para no doble-contar.
 *  - parser de montos CLP / fechas dd/mm/aaaa / cuotas con validacion (lo dudoso se aparta).
 */

import { createHash } from "node:crypto";
import {
  buildImportedMovement,
  buildMovementDedupeKey,
} from "../../client/src/domain/bank-imports";

// ----------------------------- Parsers base -----------------------------

/** "$ 1.520.000" -> 1520000 ; "$ -15.858" -> -15858 ; CLP sin decimales. */
function parseClp(text: string): number | null {
  const cleaned = String(text ?? "")
    .replace(/\$/g, "")
    .replace(/\./g, "") // separador de miles
    .replace(/\s/g, "")
    .replace(/,/g, "."); // por si hubiera decimales
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** "26/06/2026" o "26/06/26" -> "2026-06-26" (ISO). */
function parseDateCl(text: string): string | null {
  const m = String(text ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  const dd = d.padStart(2, "0");
  const mm = mo.padStart(2, "0");
  const monthN = Number(mm);
  const dayN = Number(dd);
  if (monthN < 1 || monthN > 12 || dayN < 1 || dayN > 31) return null;
  return `${year}-${mm}-${dd}`;
}

/** "01/12" -> 12 ; "01/01" -> null (sin cuotas reales). */
function parseInstallments(text: string): number | null {
  const m = String(text ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const total = Number(m[2]);
  return Number.isFinite(total) && total > 1 ? total : null;
}

/** id de documento estable: mismo movimiento -> mismo id (idempotente). */
function deterministicId(dedupeKey: string): string {
  return "edw_" + createHash("sha1").update(dedupeKey).digest("hex").slice(0, 20);
}

// ----------------------------- Clasificacion -----------------------------

const CARD_PAYMENT_RE = /monto cancelado|pago pesos|pago normal|^pagos?$|abono/i;

// ----------------------------- Datos capturados (2026-06-28) -----------------------------
// Cuenta Corriente 00-310-10777-06. La direccion (cargo vs abono) aca es PROVISORIA:
// el scraper real (Etapa 3) leera las columnas Cargos/Abono por separado, sin inferir.
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

// Tarjeta de credito ****7232 - no facturados.
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

// Tarjeta de credito ****7232 - facturados.
const CARD_BILLED_RAW = [
  { date: "22/05/2026", desc: "MONTO CANCELADO", cuotas: "01/01", cargo: "", pago: "$ 2.538.806" },
  { date: "20/05/2026", desc: "AGENDA PRO 2 AGEN** LAS CONDES", cuotas: "01/01", cargo: "$ 35.581", pago: "" },
  { date: "20/05/2026", desc: "AMAZON PRIME LAS CONDES", cuotas: "01/01", cargo: "$ 6.490", pago: "" },
  { date: "21/05/2026", desc: "PAYU *UBER EATS SANTIAGO", cuotas: "01/01", cargo: "$ 2.711", pago: "" },
  { date: "27/05/2026", desc: "KUSHKISEGUROS ** SANTIAGO", cuotas: "01/01", cargo: "$ 39.643", pago: "" },
  { date: "09/06/2026", desc: "COLMENA SANTIAGO", cuotas: "01/01", cargo: "$ 22.013", pago: "" },
];

// ----------------------------- Construccion -----------------------------

type Built = {
  source: string;
  id: string;
  date: string;
  description: string;
  amount: number;
  direction: string;
  movementType: string;
  paymentMethod: string;
  installmentCount: number | null;
  dedupeKey: string;
};

const issues: string[] = [];
const skipped: { source: string; date: string; desc: string; reason: string }[] = [];
const built: Built[] = [];

const NOW = "2026-06-28T00:00:00.000Z";

function pushBuilt(seed: Parameters<typeof buildImportedMovement>[0], source: string) {
  const m = buildImportedMovement(seed);
  built.push({
    source,
    id: deterministicId(m.dedupeKey),
    date: m.date,
    description: m.description,
    amount: m.amount,
    direction: m.direction,
    movementType: m.suggestedMovementType,
    paymentMethod: m.suggestedPaymentMethod,
    installmentCount: m.installmentCount,
    dedupeKey: m.dedupeKey,
  });
}

// Cuenta corriente
for (const row of CHECKING_RAW) {
  const date = parseDateCl(row.date);
  const amount = parseClp(row.amount);
  if (!date) { issues.push(`CC fecha invalida: ${row.date} (${row.desc})`); continue; }
  if (amount === null) { issues.push(`CC monto invalido: ${row.amount} (${row.desc})`); continue; }
  const isCardPayment = /cargo por pago tc/i.test(row.desc);
  const movementType = isCardPayment ? "credit_card_payment" : row.dir === "income" ? "income" : "expense";
  pushBuilt({
    batchId: "dry-run-cc",
    source: "browser_assistant",
    sourceName: "Edwards Cuenta Corriente 00-310-10777-06",
    sourceType: "bank_account",
    accountId: null,
    bankName: "Banco Edwards",
    date,
    description: row.desc,
    amount: Math.abs(amount),
    direction: row.dir as "income" | "expense",
    category: "",
    workspace: "business",
    movementType,
    paymentMethod: "bank_account",
    createdAt: NOW,
  }, "Cuenta Corriente");
}

// Tarjeta (no facturados + facturados) — los pagos se OMITEN (ya entran por la cuenta corriente)
function handleCard(rows: typeof CARD_UNBILLED_RAW, label: string) {
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
    pushBuilt({
      batchId: "dry-run-card",
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
    }, label);
  }
}

handleCard(CARD_UNBILLED_RAW, "Tarjeta (no facturados)");
handleCard(CARD_BILLED_RAW, "Tarjeta (facturados)");

// ----------------------------- Reporte -----------------------------

function clp(n: number) {
  return "$" + n.toLocaleString("es-CL");
}

console.log("\n========== ETAPA 1 — PRUEBA EN SECO (Edwards) ==========");
console.log("(no se escribio nada en la base de datos)\n");

for (const m of built) {
  const cuotas = m.installmentCount ? ` [${m.installmentCount} cuotas]` : "";
  console.log(
    `${m.date}  ${m.source.padEnd(24)}  ${clp(m.amount).padStart(12)}  ${m.movementType.padEnd(20)} ${m.description}${cuotas}`,
  );
}

console.log(`\n--- OMITIDOS (para no doble-contar) ---`);
for (const s of skipped) console.log(`  ${s.date}  ${s.source}: ${s.desc}  →  ${s.reason}`);

console.log(`\n--- CHEQUEO ANTI-DUPLICADOS (id deterministico) ---`);
const ids = built.map((m) => m.id);
const uniqueIds = new Set(ids);
console.log(`  movimientos: ${built.length} | ids unicos: ${uniqueIds.size}`);
console.log(uniqueIds.size === ids.length ? "  OK: cada movimiento tiene id propio (re-cargar lo pisa, no duplica)" : "  ⚠ HAY IDS REPETIDOS");
console.log(`  ejemplo id: ${built[0]?.id}  ←  ${built[0]?.dedupeKey}`);

console.log(`\n--- VALIDACION ---`);
if (issues.length === 0) console.log("  OK: 0 filas con problemas de parseo");
else for (const i of issues) console.log(`  ⚠ ${i}`);

console.log(`\nResumen: ${built.length} a cargar, ${skipped.length} omitidos, ${issues.length} con problemas.\n`);
