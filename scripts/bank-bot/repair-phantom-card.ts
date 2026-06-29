/**
 * Paso 2: repara la "tarjeta fantasma" que invento el bot en sesiones anteriores.
 * Renombra creditCardName "Edwards Visa ****7232" -> "T.C Edwards Pancho" (el nombre real
 * de la cuenta-tarjeta en la app) para que el historial no quede partido en dos tarjetas.
 *
 * Toca:
 *  - transactions: solo el campo creditCardName (NO cambia workspace/categoria/monto/fecha).
 *  - importedMovements: creditCardName + recalcula dedupeKey (la tarjeta es parte de la huella).
 *
 * NO cambia importes, fechas, categorias ni ambitos. Solo el nombre de la tarjeta.
 *
 * Correr:  npx tsx scripts/bank-bot/repair-phantom-card.ts --dry   (muestra)
 *          npx tsx scripts/bank-bot/repair-phantom-card.ts         (aplica)
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, updateDoc } from "firebase/firestore/lite";
import type { ImportedMovement, Transaction } from "../../shared/schema";
import { buildMovementDedupeKey } from "../../client/src/domain/bank-imports";

const DRY = process.argv.includes("--dry");
const NOW = new Date().toISOString();
const PHANTOM = "Edwards Visa ****7232";
const REAL = "T.C Edwards Pancho";
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

async function main() {
  // 1) transactions
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => ({ id: d.id, ...(d.data() as Transaction) }));
  const txHits = txs.filter((t) => t.creditCardName === PHANTOM);
  console.log(`${DRY ? "[DRY] " : ""}Transacciones con "${PHANTOM}": ${txHits.length}`);
  for (const t of txHits) console.log(`  ${t.date} $${Number(t.amount).toLocaleString("es-CL")} ${(t as any).name?.slice(0, 40)} | ws=${t.workspace}`);

  // 2) importedMovements (cualquier status que aun tenga la tarjeta fantasma)
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }));
  const movHits = movs.filter((m) => m.creditCardName === PHANTOM);
  console.log(`\n${DRY ? "[DRY] " : ""}Movimientos importados con "${PHANTOM}": ${movHits.length}`);
  for (const m of movHits) console.log(`  [${m.status}] ${m.date} $${Number(m.amount).toLocaleString("es-CL")} ${m.description?.slice(0, 40)}`);

  if (DRY) { console.log("\n(no se escribio nada)"); return; }

  for (const t of txHits) await updateDoc(doc(db, "transactions", t.id), { creditCardName: REAL, updatedAt: NOW });
  for (const m of movHits) {
    const dedupeKey = buildMovementDedupeKey({
      date: m.date, description: m.description, amount: Number(m.amount) || 0, direction: m.direction,
      sourceType: m.sourceType, accountId: m.accountId ?? null, creditCardName: REAL, bankName: m.bankName,
    });
    await updateDoc(doc(db, "importedMovements", m.id), { creditCardName: REAL, dedupeKey, updatedAt: NOW });
  }
  console.log(`\nReparado: ${txHits.length} transacciones + ${movHits.length} movimientos renombrados a "${REAL}".`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
