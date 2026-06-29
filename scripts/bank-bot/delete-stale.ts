/**
 * Borra movimientos importados PENDIENTES con identidad VIEJA (de antes del Paso 1):
 *  - Edwards con la tarjeta fantasma "Edwards Visa ****7232"
 *  - Santander (bank_account, Banco Santander) sin accountId
 * Solo toca status "pending" (no toca nada convertido/conciliado). Despues los loaders
 * recargan con la identidad correcta.
 *
 * Correr:  npx tsx scripts/bank-bot/delete-stale.ts --dry   (muestra)
 *          npx tsx scripts/bank-bot/delete-stale.ts         (borra)
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, deleteDoc, doc, getDocs, getFirestore } from "firebase/firestore/lite";
import type { ImportedMovement } from "../../shared/schema";
const DRY = process.argv.includes("--dry");
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

async function main() {
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }));
  const stale = movs.filter((m) => m.status === "pending" && (
    m.creditCardName === "Edwards Visa ****7232" ||
    (m.sourceType === "bank_account" && m.bankName === "Banco Santander" && !m.accountId)
  ));
  console.log(`${DRY ? "[DRY] " : ""}Movimientos pendientes con identidad vieja a borrar: ${stale.length}`);
  for (const m of stale) console.log(`  ${m.date} $${Number(m.amount).toLocaleString("es-CL")} ${m.description?.slice(0, 45)} | card=${m.creditCardName ?? "-"} acct=${m.accountId ?? "-"}`);
  if (DRY) { console.log("\n(no se borro nada)"); return; }
  for (const m of stale) await deleteDoc(doc(db, "importedMovements", m.id));
  console.log(`\nBorrados ${stale.length}.`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
