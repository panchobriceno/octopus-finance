/**
 * Pipeline Edwards por EMAIL: lee compras con tarjeta del Gmail (read_gmail.py),
 * parsea, deduplica (vs movimientos y vs transacciones por monto+fecha), categoriza
 * con las reglas, y carga a la bandeja de importacion.
 *
 * Correr:  npx tsx scripts/bank-bot/load-email-edwards.ts --dry [dias]
 *          npx tsx scripts/bank-bot/load-email-edwards.ts [dias]
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, query, where, writeBatch } from "firebase/firestore/lite";
import type { ImportBatch, ImportedMovement, MovementRule, Transaction } from "../../shared/schema";
import { buildImportedMovement, findBestMovementRule, applyMovementRule } from "../../client/src/domain/bank-imports";
import { parseEdwardsCardPurchase } from "./parse-email";

const DRY = process.argv.includes("--dry");
const DAYS = process.argv.find((a) => /^\d+$/.test(a)) ?? "7";
const NOW = new Date().toISOString();

function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));
const detId = (k: string) => "edwmail_" + createHash("sha1").update(k).digest("hex").slice(0, 20);
const daysBetween = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

async function main() {
  // 1) leer correos
  const raw = execFileSync("python3", ["scripts/bank-bot/read_gmail.py", "extract", DAYS], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const emails: { date: string; subject: string; body: string }[] = JSON.parse(raw || "[]");

  // 2) parsear -> seeds
  const seeds = emails.map((e) => parseEdwardsCardPurchase(e.body)).filter(Boolean) as ReturnType<typeof parseEdwardsCardPurchase>[];
  console.log(`Correos: ${emails.length} | compras parseadas: ${seeds.length}`);
  if (seeds.length === 0) { console.log("Nada que cargar."); return; }

  // 3) datos para dedup + reglas
  const rules = (await getDocs(collection(db, "movementRules"))).docs.map((d) => ({ id: d.id, ...(d.data() as MovementRule) }));
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as Transaction).filter((t) => (t.status ?? "paid") !== "cancelled");
  const start = seeds.map((s) => s!.date).sort()[0];
  const end = seeds.map((s) => s!.date).sort().slice(-1)[0];
  const existingMovs = (await getDocs(query(collection(db, "importedMovements"), where("date", ">=", start), where("date", "<=", end)))).docs.map((d) => d.data() as ImportedMovement);
  const existingKeys = new Set(existingMovs.filter((m) => m.status !== "discarded").map((m) => m.dedupeKey));

  const batchRef = doc(collection(db, "importBatches"));
  const batchId = batchRef.id;

  let dupTx = 0, dupMov = 0, fresh = 0;
  const rows = seeds.map((s) => {
    let m = buildImportedMovement({ ...s!, batchId });
    const rule = findBestMovementRule(m as unknown as ImportedMovement, rules);
    if (rule) m = applyMovementRule(m as unknown as ImportedMovement, rule);
    const alreadyMov = existingKeys.has(m.dedupeKey);
    const matchTx = txs.find((t) => Number(t.amount) === m.amount && daysBetween(t.date, m.date) <= 5);
    let status: ImportedMovement["status"] = "pending";
    if (alreadyMov) { status = "duplicate"; dupMov++; }
    else if (matchTx) { status = "duplicate"; dupTx++; }
    else fresh++;
    return { id: detId(m.dedupeKey), data: { ...m, status } };
  });

  console.log(`Nuevos: ${fresh} | duplicado-de-movimiento: ${dupMov} | duplicado-de-transaccion: ${dupTx}`);
  for (const r of rows) console.log(`  [${r.data.status}] ${r.data.date} $${r.data.amount.toLocaleString("es-CL")} ${r.data.description} -> ${r.data.suggestedCategory}`);

  if (DRY) { console.log("\n[DRY] no se escribio nada."); return; }

  // Solo cargamos compras NUEVAS (las duplicadas ya estan en el sistema).
  const freshRows = rows.filter((r) => r.data.status === "pending");
  if (freshRows.length === 0) { console.log("\nSin compras nuevas; no se crea lote."); return; }

  const batchPayload: Omit<ImportBatch, "id"> = {
    label: `Edwards Tarjeta (email) — ${new Date().toLocaleDateString("es-CL")}`,
    source: "email", sourceName: "Edwards Tarjeta (correos)", sourceType: "credit_card",
    bankName: "Banco Edwards", accountId: null, creditCardName: "Edwards Visa ****7232", workspace: "business",
    periodStart: start, periodEnd: end, rowCount: freshRows.length,
    totalIncome: 0, totalExpense: freshRows.reduce((s, r) => s + r.data.amount, 0),
    duplicateCount: 0, status: "reviewing", isDemo: false,
    notes: "Cargado por bank-bot (Edwards email)", createdAt: NOW, updatedAt: NOW,
  };
  const batch = writeBatch(db);
  batch.set(batchRef, batchPayload);
  for (const r of freshRows) batch.set(doc(db, "importedMovements", r.id), r.data);
  await batch.commit();
  console.log(`\nCargado lote con ${freshRows.length} compras nuevas.`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
