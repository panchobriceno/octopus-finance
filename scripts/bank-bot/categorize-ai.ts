/**
 * Paso 5: categorizacion con IA (la IA SOLO sugiere). Corre DESPUES de las reglas.
 * Lo que quedo "Sin categoria" se manda en UNA llamada a `claude -p` (suscripcion, gratis,
 * mismo patron que el agente de blog bajo launchd). La IA elige SOLO de la lista real de
 * categorias del usuario; si nada calza, deja "Sin categoria" (no inventa).
 *
 * Seguridad (best-effort, fail-closed) — tras review de Codex:
 *  - Cualquier error (env, firestore, claude, JSON) -> exit 0, no bloquea el orquestador.
 *  - Si la IA no responde una fila (omision/truncado/parseo fallido) -> NO se marca -> se
 *    reintenta otro dia. Solo se marca "vista" la fila que la IA realmente respondio.
 *  - Marca con campo dedicado `aiCategorizedAt` (no pisa notes del usuario).
 *  - Solo manda descripcion + monto + lista de categorias. NADA de RUTs/saldos/cuentas.
 *  - Valida categoria contra la lista y el tipo (gasto/ingreso). Descarta invalidas.
 *  - Sugerencias a confianza 80 (<85) -> FUERA del clic masivo "confiables". Vos las aceptas.
 *  - Escritura en chunks de 400 (limite de writeBatch = 500).
 *
 * Correr:  npx tsx scripts/bank-bot/categorize-ai.ts --dry
 *          npx tsx scripts/bank-bot/categorize-ai.ts
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { collection, doc, getDocs, writeBatch, type Firestore } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";
import type { ImportedMovement } from "../../shared/schema";

const DRY = process.argv.includes("--dry");
const NOW = new Date().toISOString();
const CLAUDE_BIN = path.join(os.homedir(), ".npm-global/bin/claude");
const AI_CONFIDENCE = 80; // <85 a proposito: la IA sugiere, no autoconvierte
const CHUNK = 400; // < 500 (limite writeBatch)
const isSinCat = (c: unknown) => { const n = String(c ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); return n === "" || n === "sin categoria"; };

function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }

/** Llama a claude -p (stdin), sobre JSON estable. Devuelve el texto del modelo o null si falla. */
function callClaude(prompt: string): string | null {
  try {
    const out = execFileSync(CLAUDE_BIN, ["-p", "--output-format", "json", "--max-turns", "1"], { input: prompt, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    try { const env = JSON.parse(out); if (env && typeof env.result === "string") return env.result; } catch { /* no es sobre */ }
    return out;
  } catch (e: any) {
    console.error("IA no disponible (best-effort, se omite):", e?.message ?? e);
    return null;
  }
}

/** Extrae el primer array JSON balanceado de un texto (tolera prosa y fences). */
function parseJsonArray(text: string): any[] | null {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { try { const a = JSON.parse(text.slice(start, i + 1)); return Array.isArray(a) ? a : null; } catch { return null; } } }
  }
  return null;
}

async function commitChunked(db: Firestore, updates: { id: string; patch: Record<string, unknown> }[]) {
  for (let off = 0; off < updates.length; off += CHUNK) {
    const batch = writeBatch(db);
    for (const u of updates.slice(off, off + CHUNK)) batch.update(doc(db, "importedMovements", u.id), u.patch);
    await batch.commit();
  }
}

async function main() {
  loadEnv(path.join(process.cwd(), ".env.local"));
  loadEnv(path.join(process.cwd(), "client", ".env.local"));
  const db = await getAuthedDb();

  // Categorias reales por tipo (la lista blanca es la coleccion categories)
  const cats = (await getDocs(collection(db, "categories"))).docs.map((d) => d.data() as { name: string; type: string });
  const byType: Record<string, Set<string>> = { income: new Set(), expense: new Set() };
  for (const c of cats) { const t = c.type === "income" ? "income" : "expense"; if (c.name && !isSinCat(c.name)) byType[t].add(c.name); }
  const validFor = (dir: string) => byType[dir === "income" ? "income" : "expense"];

  // Pendientes sin categoria que la IA aun no proceso (campo dedicado aiCategorizedAt)
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }));
  const todo = movs.filter((m) => m.status === "pending" && isSinCat(m.suggestedCategory) && !(m as any).aiCategorizedAt);
  console.log(`Movimientos sin categoria para la IA: ${todo.length}`);
  if (todo.length === 0) { console.log("Nada para categorizar."); return; }

  const expenseList = [...byType.expense].sort();
  const incomeList = [...byType.income].sort();
  const lines = todo.map((m, i) => `[${i}] ${m.direction === "income" ? "ingreso" : "gasto"} $${Number(m.amount).toLocaleString("es-CL")} — "${String(m.description ?? "").slice(0, 80)}"`);
  const prompt = [
    "Sos el categorizador de movimientos de Pancho (dueño de la agencia de marketing 'Octopus Media' + gastos personales/familia). Para CADA movimiento elegí (1) la MEJOR categoria de la lista y (2) el AMBITO: 'business' (empresa: software/herramientas de trabajo, publicidad/ads, servicios profesionales, suscripciones de la agencia) o 'family' (personal/hogar: comida, supermercado, streaming personal, salud, ropa, transporte).",
    "Si ninguna categoria calza con claridad usá \"Sin categoria\". NO inventes categorias. Respetá el tipo: un GASTO solo lleva categoria de gasto; un INGRESO solo de ingreso.",
    "",
    `Categorias de GASTO validas: ${expenseList.join(" | ")}`,
    `Categorias de INGRESO validas: ${incomeList.join(" | ")}`,
    "",
    "Guía de ámbito: Netflix -> family/Digital; Slack, Adobe, GitHub, Hubspot, Google Workspace, Anthropic/Claude, Metricool, Freepik, Squarespace, Suno -> business/Software Empresa; Facebook/Google ads -> business; Jumbo/supermercado, Uber Eats, farmacia, ropa -> family.",
    "",
    "Movimientos:",
    ...lines,
    "",
    "Responde para CADA movimiento (no omitas ninguno). SOLO un array JSON, sin texto adicional:",
    '[{"i":0,"category":"<categoria exacta o Sin categoria>","ambito":"business|family"}, ...]',
  ].join("\n");

  console.log(`Llamando a la IA (claude -p) para ${todo.length} movimientos...`);
  const raw = callClaude(prompt);
  if (!raw) { console.log("Sin respuesta de la IA; no se toca nada (se reintenta otro dia)."); return; }
  const arr = parseJsonArray(raw);
  if (!arr || arr.length === 0) { console.log("La IA no devolvio JSON usable; no se toca nada (se reintenta)."); return; }

  // Solo consideramos filas que la IA REALMENTE respondio (las omitidas se reintentan).
  const answered = new Map<number, { category: string; ambito: string }>();
  for (const item of arr) {
    const i = Number(item?.i);
    if (Number.isInteger(i) && i >= 0 && i < todo.length && typeof item?.category === "string") answered.set(i, { category: item.category.trim(), ambito: String(item?.ambito ?? "").trim() });
  }

  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  let applied = 0, noFit = 0;
  for (let i = 0; i < todo.length; i++) {
    if (!answered.has(i)) continue; // la IA no la respondio -> reintentar otro dia
    const m = todo[i];
    const { category: cat, ambito } = answered.get(i)!;
    const ws = ambito === "business" || ambito === "family" ? ambito : null; // ambito valido -> tambien ajusta el ambito
    const ok = !isSinCat(cat) && validFor(m.direction).has(cat);
    if (ok) { updates.push({ id: m.id, patch: { suggestedCategory: cat, ...(ws ? { suggestedWorkspace: ws } : {}), confidence: AI_CONFIDENCE, matchedRuleId: null, aiCategorizedAt: NOW, updatedAt: NOW } }); applied++; }
    else { updates.push({ id: m.id, patch: { aiCategorizedAt: NOW, updatedAt: NOW } }); noFit++; }
    console.log(`  [${i}] ${m.direction} $${Number(m.amount).toLocaleString("es-CL")} ${String(m.description).slice(0, 38)} -> ${ok ? `${cat} / ${ws ?? "(ámbito s/c)"}` : "(sin sugerencia)"}`);
  }
  console.log(`\nRespondidas ${answered.size}/${todo.length} | con categoria: ${applied} | sin sugerencia: ${noFit} | omitidas (reintento): ${todo.length - answered.size}`);

  if (DRY) { console.log("\n[DRY] no se escribio nada."); return; }
  await commitChunked(db, updates);
  console.log(`\nIA aplico ${applied} categorias (confianza ${AI_CONFIDENCE}, fuera del clic masivo).`);
}
main().catch((e) => { console.error("ERROR (best-effort, no bloquea):", e?.message ?? e); process.exit(0); });
