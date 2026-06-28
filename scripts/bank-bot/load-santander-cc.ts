/**
 * Cargar movimientos de la CUENTA CORRIENTE Santander Empresa (0-000-7387399-1, CLP)
 * a la bandeja de la app. Mismo patron idempotente que los otros cargadores.
 *
 * Datos transcritos de la cartola de junio (01-27/06/2026) que paso Pancho.
 * CARGO -> expense, ABONO -> income, "Pago Automatico T. de Credito" -> credit_card_payment.
 *
 * Correr:  npx tsx scripts/bank-bot/load-santander-cc.ts [--dry]
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, query, where, writeBatch } from "firebase/firestore/lite";
import type { ImportBatch, ImportedMovement, MovementSeedInput } from "../../shared/schema";
import { buildImportedMovement } from "../../client/src/domain/bank-imports";

const DRY = process.argv.includes("--dry");
const NOW = "2026-06-28T00:00:00.000Z";

type Row = { date: string; desc: string; cargo?: number; abono?: number };

// Cartola cuenta corriente Santander 0-000-7387399-1 — junio 2026
const ROWS: Row[] = [
  { date: "2026-06-25", desc: "Traspaso con la Cuenta N° 002002409405", abono: 32060 },
  { date: "2026-06-25", desc: "COM.MANTENCION PLAN", cargo: 32060 },
  { date: "2026-06-22", desc: "Traspaso con la Cuenta N° 002002409405", abono: 36095 },
  { date: "2026-06-22", desc: "PAGO EN LINEA S.I.I.", cargo: 527392 },
  { date: "2026-06-22", desc: "MERCADOPAGO*CANTABRIA", cargo: 27687 },
  { date: "2026-06-18", desc: "0762527138 Transf. HARISTOY CENTRO ODONTOLOGICO LIMIT", abono: 250000 },
  { date: "2026-06-17", desc: "SOCIEDAD BRAVO PADEL LIMI", cargo: 8000 },
  { date: "2026-06-17", desc: "Compra Nacional ARAMCO", cargo: 30000 },
  { date: "2026-06-17", desc: "0783187787 Transf a Da Ponte Pulgar Spa", cargo: 66000 },
  { date: "2026-06-17", desc: "0127421048 Transf a Pablo Caro Gajardo", cargo: 260000 },
  { date: "2026-06-16", desc: "0170418220 Transf a Francisco Briceño", cargo: 3000000 },
  { date: "2026-06-16", desc: "0096900503 Transf de SANDRA AGUAYO FREIR", abono: 273000 },
  { date: "2026-06-16", desc: "0096900503 Transf de SANDRA AGUAYO FREIR", abono: 21470 },
  { date: "2026-06-15", desc: "INVERSIONES NTBB SPA", cargo: 17160 },
  { date: "2026-06-15", desc: "PAGO EN LINEA PREVIRED", cargo: 421322 },
  { date: "2026-06-12", desc: "Compra Nacional CV 1044", cargo: 27470 },
  { date: "2026-06-12", desc: "Compra Nacional SB 638", cargo: 55911 },
  { date: "2026-06-12", desc: "0779236250 Transf. INSTITUTO CARDIOVASCULAR SpA", abono: 773500 },
  { date: "2026-06-10", desc: "PAGO EN LINEA SERVIPAG", cargo: 131655 },
  { date: "2026-06-09", desc: "Pago Automático T. de Crédito", cargo: 5000 },
  { date: "2026-06-10", desc: "MERCADOPAGO*BASAJAUNSPA", cargo: 13800 },
  { date: "2026-06-10", desc: "MERCADOPAGO*BASAJAUNSPA", cargo: 30500 },
  { date: "2026-06-10", desc: "76.107.223-4 Transf. SOCIEDAD", abono: 535500 },
  { date: "2026-06-09", desc: "0798552503 Transf. CECILIA SANZ Y COMPANIA LIMITADA", abono: 476000 },
  { date: "2026-06-09", desc: "76.002.697-2 Transf. ABEL RENE", abono: 690200 },
  { date: "2026-06-09", desc: "076881709K Transf. CHILE AIRES SPA", abono: 595000 },
  { date: "2026-06-08", desc: "CASA IDEAS MALL PLAZA", cargo: 56570 },
  { date: "2026-06-08", desc: "PAC Entel Pcs 0100510098246", cargo: 11990 },
  { date: "2026-06-05", desc: "PAC CGE DISTRIB 00009739484", cargo: 47100 },
  { date: "2026-06-05", desc: "0096900503 Transf de SANDRA AGUAYO FREIR", abono: 23700 },
  { date: "2026-06-05", desc: "0761517708 Transf de INSTITUTO EDUCACION", abono: 100000 },
  { date: "2026-06-04", desc: "MERCADOPAGO*ECMINGENIERIA", cargo: 4360 },
  { date: "2026-06-04", desc: "0651731763 Transf de FUNDACION EDUCACION", abono: 142800 },
  { date: "2026-06-02", desc: "MERCADOPAGO*ECMINGENIERIA", cargo: 4059 },
  { date: "2026-06-02", desc: "0167690262 Transf. Camila Fernanda Lama Navarro", abono: 100000 },
  { date: "2026-06-01", desc: "Compra Nacional COPEC ASISTIDO", cargo: 41000 },
];

function loadEnvFile(fp: string) {
  if (!fs.existsSync(fp)) return;
  for (const line of fs.readFileSync(fp, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const sep = t.indexOf("="); if (sep === -1) continue;
    const k = t.slice(0, sep).trim();
    const v = t.slice(sep + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
function reqEnv(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
function createDb() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env.local"));
  loadEnvFile(path.join(root, "client", ".env.local"));
  const app = initializeApp({
    apiKey: reqEnv("VITE_FIREBASE_API_KEY"),
    authDomain: reqEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: reqEnv("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: reqEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: reqEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: reqEnv("VITE_FIREBASE_APP_ID"),
  });
  return getFirestore(app);
}
function detId(k: string) { return "santcc_" + createHash("sha1").update(k).digest("hex").slice(0, 20); }

function toSeed(row: Row, batchId: string): MovementSeedInput {
  const isPayment = /pago autom.tico t\. de cr.dito/i.test(row.desc);
  const direction: "income" | "expense" = row.abono != null ? "income" : "expense";
  const amount = row.abono ?? row.cargo ?? 0;
  const movementType = isPayment ? "credit_card_payment" : direction;
  return {
    batchId,
    source: "browser_assistant",
    sourceName: "Santander Cuenta Corriente 0-000-7387399-1",
    sourceType: "bank_account",
    bankName: "Banco Santander",
    date: row.date,
    description: row.desc,
    amount,
    direction,
    category: "Sin categoría",
    workspace: "business",
    movementType: movementType as MovementSeedInput["movementType"],
    paymentMethod: "bank_account",
    createdAt: NOW,
  };
}

async function main() {
  const db = createDb();
  console.log(`${DRY ? "[DRY] " : ""}Cargando cuenta corriente Santander a ${process.env.VITE_FIREBASE_PROJECT_ID}...`);

  const batchRef = doc(collection(db, "importBatches"));
  const batchId = batchRef.id;
  const movements = ROWS.map((r) => { const m = buildImportedMovement(toSeed(r, batchId)); return { id: detId(m.dedupeKey), data: m }; });

  const dates = movements.map((m) => m.data.date).sort();
  const start = dates[0], end = dates[dates.length - 1];

  const existingSnap = await getDocs(query(collection(db, "importedMovements"), where("date", ">=", start), where("date", "<=", end)));
  const existing = new Set<string>();
  existingSnap.forEach((d) => { const x = d.data() as ImportedMovement; if (x.status !== "discarded") existing.add(x.dedupeKey); });
  const fresh = movements.filter((m) => !existing.has(m.data.dedupeKey));

  console.log(`Total: ${movements.length} | nuevos: ${fresh.length} | ya existian: ${movements.length - fresh.length}`);
  if (fresh.length === 0) { console.log("Nada nuevo que cargar."); return; }

  const totalIncome = fresh.filter((m) => m.data.direction === "income").reduce((s, m) => s + m.data.amount, 0);
  const totalExpense = fresh.filter((m) => m.data.direction === "expense").reduce((s, m) => s + m.data.amount, 0);

  const batchPayload: Omit<ImportBatch, "id"> = {
    label: `Santander Cuenta Corriente — ${new Date().toLocaleDateString("es-CL")}`,
    source: "browser_assistant",
    sourceName: "Santander Cuenta Corriente 0-000-7387399-1",
    sourceType: "bank_account",
    bankName: "Banco Santander",
    accountId: null,
    creditCardName: null,
    workspace: "business",
    periodStart: start, periodEnd: end,
    rowCount: fresh.length,
    totalIncome, totalExpense,
    duplicateCount: 0,
    status: "reviewing",
    isDemo: false,
    notes: "Cargado por bank-bot (Santander cuenta corriente)",
    createdAt: NOW, updatedAt: NOW,
  };

  if (DRY) {
    console.log(`[DRY] crearia lote con ${fresh.length} movimientos. Ingresos $${totalIncome.toLocaleString("es-CL")} / Gastos $${totalExpense.toLocaleString("es-CL")}`);
    return;
  }

  const batch = writeBatch(db);
  batch.set(batchRef, batchPayload);
  for (const m of fresh) batch.set(doc(db, "importedMovements", m.id), m.data);
  await batch.commit();
  console.log(`Cargados ${fresh.length} movimientos de la cuenta corriente Santander. Revisalos en la app.`);
}

main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
