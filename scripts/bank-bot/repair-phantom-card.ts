/**
 * Paso 2: repara la "tarjeta fantasma" que invento el bot en sesiones anteriores.
 * Renombra creditCardName "Edwards Visa ****7232" -> "T.C Edwards Pancho" (nombre real de la
 * cuenta-tarjeta) para que el historial no quede partido en dos tarjetas.
 *
 * Cobertura (tras review de Codex) — todas las colecciones que guardan el nombre de tarjeta:
 *  - transactions, importBatches, movementRules, commitmentTemplates, commitmentInstances:
 *    campo creditCardName.
 *  - credit_card_settings: campos cardName/creditCardName.
 *  - importedMovements: creditCardName + recalcula dedupeKey (la tarjeta es parte de la huella);
 *    imprime colisiones de dedupeKey antes de escribir.
 *  - accounts: NO se renombra; solo verifica (no debe existir cuenta fantasma; debe existir la real).
 * NO cambia importes, fechas, categorias ni ambitos. Escritura atomica (writeBatch).
 *
 * Correr:  npx tsx scripts/bank-bot/repair-phantom-card.ts --dry   (muestra)
 *          npx tsx scripts/bank-bot/repair-phantom-card.ts         (aplica)
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, writeBatch } from "firebase/firestore/lite";
import type { ImportedMovement } from "../../shared/schema";
import { buildMovementDedupeKey } from "../../client/src/domain/bank-imports";

const DRY = process.argv.includes("--dry");
const NOW = new Date().toISOString();
const PHANTOM = "Edwards Visa ****7232";
const REAL = "T.C Edwards Pancho";
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

type Update = { ref: ReturnType<typeof doc>; patch: Record<string, unknown>; label: string };

async function scanField(coll: string, fields: string[]): Promise<Update[]> {
  const snap = await getDocs(collection(db, coll));
  const ups: Update[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const f of fields) if (data[f] === PHANTOM) patch[f] = REAL;
    if (Object.keys(patch).length) {
      patch.updatedAt = NOW;
      ups.push({ ref: doc(db, coll, d.id), patch, label: `${coll}/${d.id} [${Object.keys(patch).filter((k) => k !== "updatedAt").join(",")}]` });
    }
  }
  return ups;
}

async function main() {
  const updates: Update[] = [];

  // Colecciones con campo creditCardName (string)
  for (const coll of ["transactions", "importBatches", "movementRules", "commitmentTemplates", "commitmentInstances"]) {
    const ups = await scanField(coll, ["creditCardName"]);
    console.log(`${coll}: ${ups.length}`);
    updates.push(...ups);
  }
  // credit_card_settings puede usar cardName o creditCardName
  const ccs = await scanField("credit_card_settings", ["cardName", "creditCardName"]);
  console.log(`credit_card_settings: ${ccs.length}`);
  updates.push(...ccs);

  // importedMovements: renombrar + recalcular dedupeKey
  const movsSnap = await getDocs(collection(db, "importedMovements"));
  const allMovs = movsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }));
  const movHits = allMovs.filter((m) => m.creditCardName === PHANTOM);
  const existingKeys = new Map<string, string>(); // dedupeKey -> movId (no fantasma, no descartado)
  for (const m of allMovs) if (m.creditCardName !== PHANTOM && m.status !== "discarded" && m.dedupeKey) existingKeys.set(m.dedupeKey, m.id);
  let collisions = 0;
  for (const m of movHits) {
    const dedupeKey = buildMovementDedupeKey({ date: m.date, description: m.description, amount: Number(m.amount) || 0, direction: m.direction, sourceType: m.sourceType, accountId: m.accountId ?? null, creditCardName: REAL, bankName: m.bankName });
    if (existingKeys.has(dedupeKey)) { collisions++; console.log(`  COLISION dedupeKey: mov ${m.id} chocaria con ${existingKeys.get(dedupeKey)} (${m.description?.slice(0, 35)})`); }
    updates.push({ ref: doc(db, "importedMovements", m.id), patch: { creditCardName: REAL, dedupeKey, updatedAt: NOW }, label: `importedMovements/${m.id} [${m.status}] ${m.date} $${Number(m.amount).toLocaleString("es-CL")}` });
  }
  console.log(`importedMovements: ${movHits.length}${collisions ? ` (con ${collisions} colisiones de dedupeKey)` : ""}`);

  // accounts: verificar (no renombrar)
  const accts = (await getDocs(collection(db, "accounts"))).docs.map((d) => d.data() as Record<string, unknown>);
  const phantomAcct = accts.filter((a) => a.name === PHANTOM);
  const realAcct = accts.filter((a) => a.name === REAL);
  console.log(`\nVerificacion cuentas: fantasma="${PHANTOM}" -> ${phantomAcct.length} (debe ser 0) | real="${REAL}" -> ${realAcct.length} (debe ser 1)`);
  if (phantomAcct.length) console.log(`  AVISO: existe una cuenta llamada como la fantasma; revisar a mano.`);
  if (realAcct.length !== 1) console.log(`  AVISO: la cuenta real no existe exactamente 1 vez; revisar a mano.`);

  console.log(`\n${DRY ? "[DRY] " : ""}Total docs a actualizar: ${updates.length}`);
  for (const u of updates) console.log(`  ${u.label}`);

  if (DRY) { console.log("\n(no se escribio nada)"); return; }
  const batch = writeBatch(db);
  for (const u of updates) batch.update(u.ref, u.patch);
  await batch.commit();
  console.log(`\nReparado atomico: ${updates.length} docs renombrados a "${REAL}".`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
