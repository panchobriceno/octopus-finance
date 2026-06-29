/**
 * Carga el EECC de la tarjeta Santander (****6101) a la bandeja. Escanea PDFs en
 * ~/octopus-finance-bot/santander-eecc/ (o paths pasados por argumento), parsea nacional +
 * internacional (parse-santander-eecc.ts), deduplica (vs movimientos y transacciones),
 * categoriza con reglas (filtradas por direccion) y carga. Mueve los PDF procesados a
 * .../procesados/ para no re-procesarlos.
 *
 * Flujo mensual: bajas el EECC en tu Chrome normal -> lo dejas en la carpeta -> el bot lo procesa.
 *
 * Correr:  npx tsx scripts/bank-bot/load-santander-eecc.ts --dry [pdf...]
 *          npx tsx scripts/bank-bot/load-santander-eecc.ts [pdf...]
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, query, where, writeBatch } from "firebase/firestore/lite";
import type { ImportBatch, ImportedMovement, MovementRule, Transaction } from "../../shared/schema";
import { buildImportedMovement, findBestMovementRule, applyMovementRule } from "../../client/src/domain/bank-imports";
import { rulesForDirection, findTxDuplicate } from "./bot-helpers";
import { parseSantanderEeccPdf } from "./parse-santander-eecc";

const DRY = process.argv.includes("--dry");
const NOW = new Date().toISOString();
const FOLDER = path.join(os.homedir(), "octopus-finance-bot", "santander-eecc");
const DONE = path.join(FOLDER, "procesados");
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));
const detId = (k: string) => "saneecc_" + createHash("sha1").update(k).digest("hex").slice(0, 20);

async function main() {
  const argPdfs = process.argv.slice(2).filter((a) => a.toLowerCase().endsWith(".pdf"));
  let pdfs = argPdfs;
  let fromFolder = false;
  if (pdfs.length === 0) {
    if (!fs.existsSync(FOLDER)) { console.log(`No existe la carpeta ${FOLDER}; nada que hacer.`); return; }
    pdfs = fs.readdirSync(FOLDER).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => path.join(FOLDER, f));
    fromFolder = true;
  }
  if (pdfs.length === 0) { console.log("Sin PDFs para procesar."); return; }
  console.log(`PDFs a procesar: ${pdfs.length}`);

  // Parsear por PDF: solo moveremos a procesados/ los que dieron movimientos (los que fallan o
  // dan 0 quedan para inspeccion -> no se pierden ni se marcan como hechos).
  const parsed = pdfs.map((p) => {
    try { const s = parseSantanderEeccPdf(p); if (!s.length) console.error(`AVISO: ${path.basename(p)} no dio movimientos (revisar layout) -> no se mueve.`); return { p, seeds: s }; }
    catch (e: any) { console.error(`No se pudo parsear ${path.basename(p)} (queda sin procesar):`, e?.message ?? e); return { p, seeds: null as any }; }
  });
  const okPdfs = parsed.filter((x) => x.seeds && x.seeds.length > 0);
  const seeds = okPdfs.flatMap((x) => x.seeds);
  console.log(`Movimientos parseados: ${seeds.length} (de ${okPdfs.length}/${pdfs.length} PDFs)`);
  if (seeds.length === 0) { console.log("Nada que cargar."); return; }

  const rules = (await getDocs(collection(db, "movementRules"))).docs.map((d) => ({ id: d.id, ...(d.data() as MovementRule) }));
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as Transaction).filter((t) => (t.status ?? "paid") !== "cancelled");
  const start = seeds.map((s) => s.date).sort()[0];
  const end = seeds.map((s) => s.date).sort().slice(-1)[0];
  const existingMovs = (await getDocs(query(collection(db, "importedMovements"), where("date", ">=", start), where("date", "<=", end)))).docs.map((d) => d.data() as ImportedMovement);
  const existingKeys = new Set(existingMovs.filter((m) => m.status !== "discarded").map((m) => m.dedupeKey));

  const batchRef = doc(collection(db, "importBatches"));
  const batchId = batchRef.id;

  let dupTx = 0, dupMov = 0, fresh = 0, expense = 0;
  const seenInRun = new Set<string>();
  const rows = seeds.map((s) => {
    let m = buildImportedMovement({ ...s, batchId });
    const rule = findBestMovementRule(m as unknown as ImportedMovement, rulesForDirection(rules, m.direction));
    if (rule) m = applyMovementRule(m as unknown as ImportedMovement, rule);
    const alreadyMov = existingKeys.has(m.dedupeKey) || seenInRun.has(m.dedupeKey);
    seenInRun.add(m.dedupeKey);
    const matchTx = findTxDuplicate(txs, m);
    let status: ImportedMovement["status"] = "pending";
    if (alreadyMov) { status = "duplicate"; dupMov++; }
    else if (matchTx) { status = "duplicate"; dupTx++; }
    else { fresh++; expense += m.amount; }
    return { id: detId(m.dedupeKey), data: { ...m, status }, alreadyMov };
  });

  console.log(`Nuevos: ${fresh} | duplicado-de-movimiento: ${dupMov} | duplicado-de-transaccion: ${dupTx}`);
  for (const r of rows) console.log(`  [${r.data.status}] ${r.data.date} $${r.data.amount.toLocaleString("es-CL")} ${r.data.description} -> ${r.data.suggestedCategory}`);

  if (DRY) { console.log("\n[DRY] no se escribio nada."); return; }

  const toLoad = rows.filter((r) => !r.alreadyMov);
  if (toLoad.length > 0) {
    const batchPayload: Omit<ImportBatch, "id"> = {
      label: `Santander Tarjeta EECC — ${new Date().toLocaleDateString("es-CL")}`,
      source: "pdf", sourceName: "Santander Tarjeta ****6101 (EECC)", sourceType: "credit_card",
      bankName: "Banco Santander", accountId: null, creditCardName: "Santander Visa Empresa ****6101", workspace: "business",
      periodStart: start, periodEnd: end, rowCount: toLoad.length,
      totalIncome: 0, totalExpense: expense,
      duplicateCount: toLoad.filter((r) => r.data.status === "duplicate").length, status: "reviewing", isDemo: false,
      notes: "Cargado por bank-bot (Santander EECC PDF)", createdAt: NOW, updatedAt: NOW,
    };
    const batch = writeBatch(db);
    batch.set(batchRef, batchPayload);
    for (const r of toLoad) batch.set(doc(db, "importedMovements", r.id), r.data);
    await batch.commit();
    console.log(`\nCargado lote: ${fresh} nuevos + ${toLoad.length - fresh} posibles duplicados (visibles).`);
  } else {
    console.log("\nNada nuevo que cargar (todo ya estaba en la bandeja).");
  }

  // mover SOLO los PDFs que se parsearon OK (los fallidos quedan para inspeccion). Nombre unico
  // (timestamp) para no pisar si ya existe uno con el mismo nombre en procesados/.
  if (fromFolder) {
    fs.mkdirSync(DONE, { recursive: true });
    const ts = NOW.replace(/[:.]/g, "-");
    for (const x of okPdfs) { try { fs.renameSync(x.p, path.join(DONE, `${ts}__${path.basename(x.p)}`)); } catch (e: any) { console.error("mover:", e?.message); } }
    console.log(`Movidos ${okPdfs.length} PDF a ${DONE}`);
  }
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
