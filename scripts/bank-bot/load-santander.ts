/**
 * Cargar movimientos de Santander (tarjeta Nacional, CLP) a la bandeja de la app.
 * Mismo patron que load-edwards.ts (idempotente, id deterministico, "Sin categoria").
 *
 * SOLO carga las compras reales en pesos de la tarjeta Nacional. NO carga:
 *  - Tarjeta Internacional (esta en USD; la app es CLP -> requiere tipo de cambio).
 *  - Cuenta corriente Santander (no capturada; falta la cartola de Office Banking).
 *  - Pagos / TRASPASO A DEUDA NACIONAL / intereses-comisiones (ruido / doble conteo).
 *
 * Correr:  npx tsx scripts/bank-bot/load-santander.ts [--dry]
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, query, where, writeBatch } from "firebase/firestore/lite";
import type { ImportBatch, ImportedMovement } from "../../shared/schema";
import { buildImportedMovement } from "../../client/src/domain/bank-imports";
import type { SeedNoBatch } from "./parse-edwards";

const DRY = process.argv.includes("--dry");
const NOW = "2026-06-28T00:00:00.000Z";

// Tarjeta Santander Visa Empresa ****6101 - Nacional (CLP) - cargos del periodo.
// El gasto internacional (Facebook/Google en USD) entra en pesos como el TRASPASO A
// DEUDA NACIONAL (segun la propia cartola Santander), asi no hace falta tipo de cambio.
// Se omite MONTO CANCELADO (-$5.000) por ser un pago/abono, no un gasto.
const SANTANDER_CARD: { date: string; desc: string; amount: number }[] = [
  { date: "2026-05-30", desc: "ADOBE COMPRAS P.A.T.", amount: 32368 },
  { date: "2026-06-06", desc: "LINKEDIN LINKEDIN", amount: 22999 },
  { date: "2026-06-14", desc: "DL*GOOGLE YOUTUBE", amount: 11000 },
  { date: "2026-06-09", desc: "TRASPASO A DEUDA NACIONAL (cargos internac. Facebook/Google en USD)", amount: 178082 },
  { date: "2026-06-23", desc: "INTERESES", amount: 9984 },
  { date: "2026-06-23", desc: "IMPUESTOS", amount: 285 },
  { date: "2026-06-23", desc: "IVA USO INTERNACIONAL", amount: 886 },
  { date: "2026-06-23", desc: "SERVICIO USO INTERNACIONAL", amount: 4665 },
  { date: "2026-06-23", desc: "COMISION DE MANTENCION", amount: 2856 },
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
function detId(k: string) { return "sant_" + createHash("sha1").update(k).digest("hex").slice(0, 20); }

async function main() {
  const seeds: SeedNoBatch[] = SANTANDER_CARD.map((r) => ({
    source: "browser_assistant",
    sourceName: "Santander Tarjeta Visa Empresa ****6101",
    sourceType: "credit_card",
    creditCardName: "Santander Visa Empresa ****6101",
    bankName: "Banco Santander",
    date: r.date,
    description: r.desc,
    amount: r.amount,
    direction: "expense",
    category: "Sin categoría",
    workspace: "business",
    movementType: "expense",
    paymentMethod: "credit_card",
    createdAt: NOW,
  }));

  const db = createDb();
  console.log(`${DRY ? "[DRY] " : ""}Cargando Santander a ${process.env.VITE_FIREBASE_PROJECT_ID}...`);

  const batchRef = doc(collection(db, "importBatches"));
  const batchId = batchRef.id;
  const movements = seeds.map((s) => { const m = buildImportedMovement({ ...s, batchId }); return { id: detId(m.dedupeKey), data: m }; });
  const dates = movements.map((m) => m.data.date).sort();
  const start = dates[0], end = dates[dates.length - 1];

  const existingSnap = await getDocs(query(collection(db, "importedMovements"), where("date", ">=", start), where("date", "<=", end)));
  const existing = new Set<string>();
  existingSnap.forEach((d) => { const x = d.data() as ImportedMovement; if (x.status !== "discarded") existing.add(x.dedupeKey); });
  const fresh = movements.filter((m) => !existing.has(m.data.dedupeKey));

  if (fresh.length === 0) { console.log("0 nuevos (todos ya existian)."); return; }

  const batchPayload: Omit<ImportBatch, "id"> = {
    label: `Santander Tarjeta ****6101 — ${new Date().toLocaleDateString("es-CL")}`,
    source: "browser_assistant",
    sourceName: "Santander Tarjeta Visa Empresa ****6101",
    sourceType: "credit_card",
    bankName: "Banco Santander",
    accountId: null,
    creditCardName: "Santander Visa Empresa ****6101",
    workspace: "business",
    periodStart: start, periodEnd: end,
    rowCount: fresh.length,
    totalIncome: 0,
    totalExpense: fresh.reduce((s, m) => s + m.data.amount, 0),
    duplicateCount: 0,
    status: "reviewing",
    isDemo: false,
    notes: "Cargado por bank-bot (Santander)",
    createdAt: NOW, updatedAt: NOW,
  };

  if (DRY) { console.log(`[DRY] crearia lote con ${fresh.length} nuevos:`); fresh.forEach((m) => console.log(`   ${m.data.date} ${m.data.description} $${m.data.amount.toLocaleString("es-CL")}`)); return; }

  const batch = writeBatch(db);
  batch.set(batchRef, batchPayload);
  for (const m of fresh) batch.set(doc(db, "importedMovements", m.id), m.data);
  await batch.commit();
  console.log(`Cargados ${fresh.length} movimientos de Santander (tarjeta Nacional). Revisalos en la app.`);
}

main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
