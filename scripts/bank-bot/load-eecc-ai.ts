/**
 * Lector de EECC con IA (genérico, cualquier banco/formato). Desencripta con -upw, le pasa el
 * TEXTO a Claude (claude -p, suscripción) para extraer los movimientos reales (montos correctos,
 * conversión US$→CLP con la tasa del propio estado), filtra montos absurdos, deduplica, categoriza
 * y carga a la bandeja. La tarjeta/ámbito los fija el CÓDIGO según el encabezado (no la IA).
 *
 * Correr:  npx tsx scripts/bank-bot/load-eecc-ai.ts --dry --pass=1822 <pdf...>
 *          npx tsx scripts/bank-bot/load-eecc-ai.ts --pass=1822 <pdf...>
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, query, where, writeBatch } from "firebase/firestore/lite";
import type { ImportBatch, ImportedMovement, MovementRule, Transaction } from "../../shared/schema";
import type { MovementSeedInput } from "./parse-edwards";
import { buildImportedMovement, findBestMovementRule, applyMovementRule } from "../../client/src/domain/bank-imports";
import { rulesForDirection, findTxDuplicate } from "./bot-helpers";

const DRY = process.argv.includes("--dry");
const NOW = new Date().toISOString();
const PDFTOTEXT = "/opt/homebrew/bin/pdftotext";
const CLAUDE_BIN = path.join(os.homedir(), ".npm-global/bin/claude");
const CAP = 5_000_000; // un cargo de tarjeta personal/empresa rara vez supera esto -> tope anti-basura
const passArg = process.argv.find((a) => a.startsWith("--pass="));
const PASS = passArg ? passArg.split("=")[1] : undefined;

type CardId = { sourceName: string; creditCardName: string; bankName: string; workspace: string };
const CARDS: Record<string, CardId> = {
  "6101": { sourceName: "Santander Tarjeta ****6101", creditCardName: "Santander Visa Empresa ****6101", bankName: "Banco Santander", workspace: "business" },
  "7232": { sourceName: "Edwards Tarjeta ****7232", creditCardName: "T.C Edwards Pancho", bankName: "Banco Edwards", workspace: "family" },
};
function cardIdentity(text: string): CardId {
  let last4: string | null = null;
  for (const line of text.split(/\r?\n/)) { if (/de tarjeta de cr/i.test(line)) { const g = line.match(/\d{4}/g); if (g) { last4 = g[g.length - 1]; break; } } }
  return (last4 && CARDS[last4]) || { sourceName: `Tarjeta ****${last4 ?? "?"}`, creditCardName: `Tarjeta ****${last4 ?? "?"} (revisar)`, bankName: "Banco", workspace: "family" };
}

function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));
const detId = (k: string) => "eeccai_" + createHash("sha1").update(k).digest("hex").slice(0, 20);

function pdftext(p: string): string {
  const args = ["-layout"]; if (PASS) args.push("-upw", PASS); args.push(p, "-");
  return execFileSync(PDFTOTEXT, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
function callClaude(prompt: string): string | null {
  try {
    const out = execFileSync(CLAUDE_BIN, ["-p", "--output-format", "json", "--max-turns", "1"], { input: prompt, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    try { const env = JSON.parse(out); if (env && typeof env.result === "string") return env.result; } catch { /* no envelope */ }
    return out;
  } catch (e: any) { console.error("IA no disponible:", e?.message ?? e); return null; }
}
function parseJsonArray(text: string): any[] | null {
  const start = text.indexOf("["); if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) { const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true; else if (c === "[") depth++; else if (c === "]") { depth--; if (depth === 0) { try { const a = JSON.parse(text.slice(start, i + 1)); return Array.isArray(a) ? a : null; } catch { return null; } } } }
  return null;
}

const EXTRACTION_PROMPT = `Sos un extractor de movimientos de un estado de cuenta (EECC) de tarjeta de crédito chileno. Te doy el TEXTO crudo del EECC. Extraé SOLO los movimientos/cargos del PERÍODO ACTUAL: compras, cargos, comisiones, intereses, impuestos, seguros.
NO incluyas: saldos anteriores, totales/subtotales, resumen, líneas de "PERÍODO ANTERIOR", "TRASPASO A DEUDA NACIONAL", "TRASPASO DE DEUDA INTERNACIONAL" (son bultos, no movimientos), ni pagos a la tarjeta ("PAGO", "MONTO CANCELADO", "ABONO", "PAGO EN LINEA").
Para cargos en US$ (sección internacional) convertí a CLP usando la tasa implícita del propio estado: en las líneas internacionales suele haber un "monto moneda origen" (en pesos) y un "monto US$"; la tasa = pesos/US$ de las líneas que tengan ambos. Si una línea ya está en CLP, usá ese valor.
Cada movimiento: date ("YYYY-MM-DD", el año según el estado), description (nombre del comercio, limpio), amount (ENTERO positivo en CLP), direction ("expense").
Devolvé SOLO un array JSON, sin texto adicional ni markdown:
[{"date":"2026-05-08","description":"NETFLIX","amount":12990,"direction":"expense"}]`;

async function main() {
  const pdfs = process.argv.slice(2).filter((a) => a.toLowerCase().endsWith(".pdf"));
  if (!pdfs.length) { console.log("Pasá rutas de PDF."); return; }

  const allSeeds: MovementSeedInput[] = [];
  for (const p of pdfs) {
    let text: string;
    try { text = pdftext(p); } catch (e: any) { console.error(`No se pudo leer ${path.basename(p)} (¿contraseña?):`, e?.message ?? e); continue; }
    const id = cardIdentity(text);
    const raw = callClaude(`${EXTRACTION_PROMPT}\n\nTEXTO DEL EECC:\n${text}`);
    const arr = raw ? parseJsonArray(raw) : null;
    if (!arr) { console.error(`IA no devolvió JSON para ${path.basename(p)} -> se omite.`); continue; }
    let ok = 0, dropped = 0;
    for (const it of arr) {
      const amount = Math.round(Number(it?.amount) || 0);
      const date = String(it?.date ?? "").match(/^\d{4}-\d{2}-\d{2}$/) ? it.date : null;
      const description = String(it?.description ?? "").trim();
      if (!date || !description || amount <= 0) { dropped++; continue; }
      if (amount > CAP) { dropped++; console.error(`  DESCARTADO monto sospechoso $${amount.toLocaleString("es-CL")} ${description}`); continue; }
      allSeeds.push({ source: "pdf", sourceName: id.sourceName, sourceType: "credit_card", bankName: id.bankName, creditCardName: id.creditCardName, accountId: null, workspace: id.workspace, paymentMethod: "credit_card", date, description, amount, direction: "expense", category: "Sin categoría", movementType: "expense", createdAt: NOW } as MovementSeedInput);
      ok++;
    }
    console.log(`${path.basename(p)} [${id.creditCardName}]: ${ok} movimientos (${dropped} descartados)`);
  }

  if (!allSeeds.length) { console.log("Nada extraído."); return; }
  console.log(`\nTotal extraído: ${allSeeds.length} | suma $${allSeeds.reduce((s, x) => s + x.amount, 0).toLocaleString("es-CL")}`);

  const rules = (await getDocs(collection(db, "movementRules"))).docs.map((d) => ({ id: d.id, ...(d.data() as MovementRule) }));
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as Transaction).filter((t) => (t.status ?? "paid") !== "cancelled");
  const start = allSeeds.map((s) => s.date).sort()[0];
  const end = allSeeds.map((s) => s.date).sort().slice(-1)[0];
  const existingMovs = (await getDocs(query(collection(db, "importedMovements"), where("date", ">=", start), where("date", "<=", end)))).docs.map((d) => d.data() as ImportedMovement);
  const existingKeys = new Set(existingMovs.filter((m) => m.status !== "discarded").map((m) => m.dedupeKey));
  const batchRef = doc(collection(db, "importBatches"));
  const batchId = batchRef.id;

  let dupTx = 0, dupMov = 0, fresh = 0, expense = 0;
  const seenInRun = new Set<string>();
  const rows = allSeeds.map((s) => {
    let m = buildImportedMovement({ ...s, batchId });
    const rule = findBestMovementRule(m as unknown as ImportedMovement, rulesForDirection(rules, m.direction));
    if (rule) m = applyMovementRule(m as unknown as ImportedMovement, rule);
    const alreadyMov = existingKeys.has(m.dedupeKey) || seenInRun.has(m.dedupeKey);
    seenInRun.add(m.dedupeKey);
    const matchTx = findTxDuplicate(txs, m);
    let status: ImportedMovement["status"] = "pending";
    if (alreadyMov) { status = "duplicate"; dupMov++; } else if (matchTx) { status = "duplicate"; dupTx++; } else { fresh++; expense += m.amount; }
    return { id: detId(m.dedupeKey), data: { ...m, status }, alreadyMov };
  });
  console.log(`Nuevos: ${fresh} | dup-de-movimiento: ${dupMov} | dup-de-transaccion: ${dupTx}`);
  for (const r of rows) console.log(`  [${r.data.status}] ${r.data.date} $${r.data.amount.toLocaleString("es-CL")} ${r.data.description} -> ${r.data.suggestedCategory} (${r.data.creditCardName})`);

  if (DRY) { console.log("\n[DRY] no se escribió nada."); return; }
  const toLoad = rows.filter((r) => !r.alreadyMov);
  if (!toLoad.length) { console.log("\nNada nuevo (todo ya estaba)."); return; }
  const batchPayload: Omit<ImportBatch, "id"> = {
    label: `EECC tarjetas (lector IA) — ${new Date().toLocaleDateString("es-CL")}`,
    source: "pdf", sourceName: "EECC (lector IA)", sourceType: "credit_card",
    bankName: "Varios", accountId: null, creditCardName: null, workspace: "business",
    periodStart: start, periodEnd: end, rowCount: toLoad.length, totalIncome: 0, totalExpense: expense,
    duplicateCount: toLoad.filter((r) => r.data.status === "duplicate").length, status: "reviewing", isDemo: false,
    notes: "Cargado por bank-bot (EECC lector IA)", createdAt: NOW, updatedAt: NOW,
  };
  const batch = writeBatch(db);
  batch.set(batchRef, batchPayload);
  for (const r of toLoad) batch.set(doc(db, "importedMovements", r.id), r.data);
  await batch.commit();
  console.log(`\nCargado: ${fresh} nuevos + ${toLoad.length - fresh} posibles duplicados (visibles).`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
