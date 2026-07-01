/**
 * Auto-categorizacion: aprende de las transacciones ya categorizadas de Pancho
 * (no hay MovementRules). Para cada movimiento pendiente del bot, busca la transaccion
 * historica mas parecida (por comercio/nombre) y le copia categoria + ambito (+ item).
 *
 * Aplica sobre los importedMovements pendientes de los lotes del bank-bot.
 *
 * Correr:  npx tsx scripts/bank-bot/categorize.ts --dry   (muestra)
 *          npx tsx scripts/bank-bot/categorize.ts         (actualiza)
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, updateDoc } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";
import type { Transaction, ImportedMovement, ImportBatch } from "../../shared/schema";

const DRY = process.argv.includes("--dry");
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = await getAuthedDb();

const STOP = new Set([
  "pago", "pagos", "compra", "compras", "comp", "nacional", "internacional", "transf", "transferencia",
  "de", "del", "la", "el", "con", "por", "en", "linea", "automatico", "automatica", "tarjeta", "credito",
  "cuenta", "spa", "ltda", "limitada", "limit", "plan", "mantencion", "sociedad", "monto", "cancelado",
  "traspaso", "deuda", "cargo", "abono", "com", "mp", "payu", "pat", "servicio", "uso", "marc",
  // genericos / ubicaciones / ruido
  "asistido", "tasa", "int", "santiago", "condes", "las", "plaza", "mall", "trebo", "pcs", "inc",
  "centro", "chile", "spa", "sa", "eirl", "dl", "admin", "mensual", "por", "corriente", "corr", "pap",
]);

function norm(s: string) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string) {
  return norm(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

type Learned = { category: string; workspace: string; itemId: string | null; score: number; from: string };

function bestMatch(desc: string, txs: Transaction[]): Learned | null {
  const movFull = norm(desc);
  const movTok = new Set(tokens(desc));
  let best: Learned | null = null;
  for (const t of txs) {
    const tFull = norm(t.name);
    let score = 0;
    if (tFull && tFull === movFull) {
      score = 1000;
    } else {
      const shared = tokens(t.name).filter((w) => movTok.has(w));
      const maxLen = shared.reduce((m, w) => Math.max(m, w.length), 0);
      // conservador: 2+ palabras compartidas, o 1 palabra-comercio de >=5 letras
      if (shared.length >= 2) score = 100 + shared.length * 10 + maxLen;
      else if (shared.length === 1 && maxLen >= 5) score = 50 + maxLen;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { category: t.category, workspace: t.workspace ?? "business", itemId: t.itemId ?? null, score, from: t.name };
    }
  }
  return best;
}

async function main() {
  const batches = (await getDocs(collection(db, "importBatches"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportBatch) }));
  const myBatchIds = new Set(batches.filter((b) => (b.notes || "").includes("bank-bot")).map((b) => b.id));

  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as Transaction)
    .filter((t) => t.category && t.category !== "Sin categoría" && t.category !== "Sin categoria");

  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }))
    .filter((m) => myBatchIds.has(m.batchId) && m.status === "pending");

  let matched = 0;
  for (const m of movs) {
    const hit = bestMatch(m.description, txs);
    if (!hit) { console.log(`  ? ${m.description.slice(0, 40)} -> (sin match, queda Sin categoria)`); continue; }
    matched++;
    const tag = hit.score >= 1000 ? "exacto" : `${hit.score / 10} palabra(s)`;
    console.log(`  ✓ ${m.description.slice(0, 38).padEnd(38)} -> ${hit.category} / ${hit.workspace}  [${tag}: ${hit.from.slice(0, 30)}]`);
    if (!DRY) {
      await updateDoc(doc(db, "importedMovements", m.id), {
        suggestedCategory: hit.category,
        suggestedWorkspace: hit.workspace,
      });
    }
  }
  console.log(`\n${DRY ? "[DRY] " : ""}Pendientes: ${movs.length} | categorizados: ${matched} | sin match: ${movs.length - matched}`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
