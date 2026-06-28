/**
 * Limpieza puntual de 3 duplicados del bot (deja las versiones pre-existentes de Pancho).
 * Borra, SOLO de los lotes del bank-bot:
 *   - transaccion "Pago:aramco" $20.000 (la que se convirtio)
 *   - importedMovements "Pago:aramco", "Pago:sociedad Bravo Pa", "Pago:bravo Sport"
 *
 * Correr:  npx tsx scripts/bank-bot/cleanup-dupes.ts --dry   (muestra)
 *          npx tsx scripts/bank-bot/cleanup-dupes.ts         (borra)
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, deleteDoc, doc, getDocs, getFirestore } from "firebase/firestore/lite";
import type { Transaction, ImportedMovement, ImportBatch } from "../../shared/schema";

const DRY = process.argv.includes("--dry");
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

// objetivo: descripcion -> monto
const TARGETS: { desc: string; amount: number }[] = [
  { desc: "Pago:aramco", amount: 20000 },
  { desc: "Pago:sociedad Bravo Pa", amount: 6000 },
  { desc: "Pago:bravo Sport", amount: 2000 },
];

async function main() {
  const batches = (await getDocs(collection(db, "importBatches"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportBatch) }));
  const myBatchIds = new Set(batches.filter((b) => (b.notes || "").includes("bank-bot")).map((b) => b.id));

  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }));
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => ({ id: d.id, ...(d.data() as Transaction) }));

  const movTargets = movs.filter((m) => myBatchIds.has(m.batchId) && TARGETS.some((t) => t.desc === m.description && t.amount === Number(m.amount)));
  const txTargets = txs.filter((t) => t.importBatchId && myBatchIds.has(t.importBatchId) && TARGETS.some((x) => x.desc === t.name && x.amount === Number(t.amount)));

  console.log("=== A BORRAR ===");
  console.log("importedMovements:");
  movTargets.forEach((m) => console.log(`  ${m.date} ${m.description} $${Number(m.amount).toLocaleString("es-CL")} (${m.status}) ${m.id}`));
  console.log("transactions:");
  txTargets.forEach((t) => console.log(`  ${t.date} ${t.name} $${Number(t.amount).toLocaleString("es-CL")} (${t.status}) ${t.id}`));

  if (DRY) { console.log("\n[DRY] no se borro nada."); return; }

  for (const m of movTargets) await deleteDoc(doc(db, "importedMovements", m.id));
  for (const t of txTargets) await deleteDoc(doc(db, "transactions", t.id));
  console.log(`\nBorrados: ${movTargets.length} movimientos + ${txTargets.length} transacciones.`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
