/**
 * Migra EN SU LUGAR (sin borrar) los movimientos importados PENDIENTES con identidad vieja,
 * para alinearlos al Paso 1. No pierde datos (los de cartola transcrita se conservan).
 *  - Edwards tarjeta fantasma "Edwards Visa ****7232" -> creditCardName "T.C Edwards Pancho",
 *    suggestedWorkspace "family".
 *  - Santander (bank_account, Banco Santander) sin accountId -> accountId "asIrUoWJkN1jH2zzJhT0".
 * Recalcula dedupeKey con la identidad nueva (la fuente es parte de la huella). Solo status pending.
 *
 * Correr:  npx tsx scripts/bank-bot/migrate-identity.ts --dry   (muestra)
 *          npx tsx scripts/bank-bot/migrate-identity.ts         (aplica)
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, updateDoc } from "firebase/firestore/lite";
import type { ImportedMovement } from "../../shared/schema";
import { buildMovementDedupeKey } from "../../client/src/domain/bank-imports";

const DRY = process.argv.includes("--dry");
const NOW = new Date().toISOString();
const EDWARDS_CARD = "T.C Edwards Pancho";
const SANTANDER_ACCT = "asIrUoWJkN1jH2zzJhT0";
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

async function main() {
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }));
  let edw = 0, san = 0;
  const updates: { id: string; patch: Record<string, unknown>; label: string }[] = [];
  for (const m of movs) {
    if (m.status !== "pending") continue;
    let creditCardName = m.creditCardName ?? null;
    let accountId = m.accountId ?? null;
    let suggestedWorkspace = m.suggestedWorkspace;
    let changed = false;
    if (m.creditCardName === "Edwards Visa ****7232") {
      creditCardName = EDWARDS_CARD; suggestedWorkspace = "family"; changed = true; edw++;
    } else if (m.sourceType === "bank_account" && m.bankName === "Banco Santander" && !m.accountId) {
      accountId = SANTANDER_ACCT; changed = true; san++;
    }
    if (!changed) continue;
    const dedupeKey = buildMovementDedupeKey({
      date: m.date, description: m.description, amount: Number(m.amount) || 0, direction: m.direction,
      sourceType: m.sourceType, accountId, creditCardName, bankName: m.bankName,
    });
    updates.push({
      id: m.id,
      patch: { creditCardName, accountId, suggestedWorkspace, dedupeKey, updatedAt: NOW },
      label: `${m.date} $${Number(m.amount).toLocaleString("es-CL")} ${m.description?.slice(0, 40)} -> card=${creditCardName ?? "-"} acct=${accountId ?? "-"}`,
    });
  }
  console.log(`${DRY ? "[DRY] " : ""}A migrar: ${updates.length} (Edwards ${edw}, Santander ${san})`);
  for (const u of updates) console.log(`  ${u.label}`);
  if (DRY) { console.log("\n(no se escribio nada)"); return; }
  for (const u of updates) await updateDoc(doc(db, "importedMovements", u.id), u.patch);
  console.log(`\nMigrados ${updates.length} movimientos (identidad corregida, sin perder datos).`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
