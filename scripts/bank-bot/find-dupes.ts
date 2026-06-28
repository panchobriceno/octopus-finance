/**
 * Detecta duplicados probables entre lo que cargo el bank-bot y lo que ya existia.
 * Empareja por MONTO + FECHA cercana (+-5 dias), ignorando el nombre
 * (porque el banco describe distinto a como vos lo tenias).
 *
 * Correr:  npx tsx scripts/bank-bot/find-dupes.ts
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
import type { Transaction, ImportedMovement, ImportBatch } from "../../shared/schema";

function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

const daysBetween = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

async function main() {
  const batches = (await getDocs(collection(db, "importBatches"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportBatch) }));
  const myBatchIds = new Set(batches.filter((b) => (b.notes || "").includes("bank-bot")).map((b) => b.id));

  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }))
    .filter((m) => myBatchIds.has(m.batchId));
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => ({ id: d.id, ...(d.data() as Transaction) }));

  // transacciones pre-existentes = NO vienen de mis lotes
  const preexisting = txs.filter((t) => !t.importBatchId || !myBatchIds.has(t.importBatchId));

  const pairs: string[] = [];
  for (const m of movs) {
    const hits = preexisting.filter((t) => Number(t.amount) === Number(m.amount) && daysBetween(t.date, m.date) <= 5);
    for (const t of hits) {
      pairs.push(`$${Number(m.amount).toLocaleString("es-CL")}  | BOT: "${m.description}" (${m.date}, ${m.status}) ↔ YA TENIAS: "${t.name}" (${t.date}, ${t.status})`);
    }
  }

  console.log(`\nMovimientos del bot: ${movs.length} | transacciones pre-existentes: ${preexisting.length}`);
  console.log(`\n=== DUPLICADOS PROBABLES (mismo monto, fecha +-5 dias) — ${pairs.length} ===`);
  if (pairs.length === 0) console.log("  (ninguno)");
  else pairs.forEach((p) => console.log("  " + p));
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
