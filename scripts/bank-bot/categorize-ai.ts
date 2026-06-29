/**
 * Paso 5: categorizacion con IA (la IA SOLO sugiere). Corre DESPUES de las reglas.
 * Lo que quedo "Sin categoria" se manda en UNA llamada a `claude -p` (suscripcion, gratis,
 * mismo patron que el agente de blog bajo launchd). La IA elige SOLO de la lista real de
 * categorias del usuario; si nada calza, deja "Sin categoria" (no inventa).
 *
 * Seguridad (best-effort, fail-closed):
 *  - Si claude falla / timeout / no devuelve JSON valido -> no toca nada (el movimiento queda
 *    "Sin categoria" y la importacion sigue). NUNCA bloquea.
 *  - Solo manda descripcion + monto + lista de categorias. NADA de RUTs/saldos/cuentas.
 *  - Valida cada categoria contra la lista y contra el tipo (gasto/ingreso). Descarta invalidas.
 *  - Sugerencias quedan en confianza 80 (<85) -> FUERA del clic masivo "confiables". Vos las aceptas.
 *  - Marca notes "[IA]..." para no re-preguntar lo mismo cada dia.
 *
 * Correr:  npx tsx scripts/bank-bot/categorize-ai.ts --dry   (llama a la IA, muestra, no escribe)
 *          npx tsx scripts/bank-bot/categorize-ai.ts
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, writeBatch } from "firebase/firestore/lite";
import type { ImportedMovement } from "../../shared/schema";

const DRY = process.argv.includes("--dry");
const NOW = new Date().toISOString();
const CLAUDE_BIN = path.join(os.homedir(), ".npm-global/bin/claude");
const AI_CONFIDENCE = 80; // <85 a proposito: la IA sugiere, no autoconvierte
const AI_MARK = "[IA]";
const SIN_CAT = "Sin categoría";
const isSinCat = (c: unknown) => { const n = String(c ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); return n === "" || n === "sin categoria"; };

function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

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

async function main() {
  // Categorias reales por tipo
  const cats = (await getDocs(collection(db, "categories"))).docs.map((d) => d.data() as { name: string; type: string });
  const byType: Record<string, Set<string>> = { income: new Set(), expense: new Set() };
  for (const c of cats) { const t = c.type === "income" ? "income" : "expense"; if (c.name && !isSinCat(c.name)) byType[t].add(c.name); }
  const validFor = (dir: string) => byType[dir === "income" ? "income" : "expense"];

  // Movimientos pendientes sin categoria y que la IA aun no vio
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }));
  const todo = movs.filter((m) => m.status === "pending" && isSinCat(m.suggestedCategory) && !String(m.notes ?? "").includes(AI_MARK));
  console.log(`Movimientos sin categoria para la IA: ${todo.length}`);
  if (todo.length === 0) { console.log("Nada para categorizar."); return; }

  const expenseList = [...byType.expense].sort();
  const incomeList = [...byType.income].sort();
  const lines = todo.map((m, i) => `[${i}] ${m.direction === "income" ? "ingreso" : "gasto"} $${Number(m.amount).toLocaleString("es-CL")} — "${String(m.description ?? "").slice(0, 80)}"`);
  const prompt = [
    "Sos un categorizador de movimientos bancarios chilenos. Para cada movimiento elegi la MEJOR categoria de la lista que corresponda. Si ninguna calza con claridad, usa \"Sin categoria\". NO inventes categorias nuevas. Respeta el tipo: un GASTO solo puede llevar categoria de gasto; un INGRESO solo de ingreso.",
    "",
    `Categorias de GASTO validas: ${expenseList.join(" | ")}`,
    `Categorias de INGRESO validas: ${incomeList.join(" | ")}`,
    "",
    "Movimientos:",
    ...lines,
    "",
    "Responde SOLO con un array JSON, sin texto adicional, con esta forma exacta:",
    '[{"i":0,"category":"<categoria exacta de la lista o Sin categoria>"}, ...]',
  ].join("\n");

  console.log(`Llamando a la IA (claude -p) para ${todo.length} movimientos...`);
  const raw = callClaude(prompt);
  if (!raw) { console.log("Sin respuesta de la IA; no se toca nada (todo queda Sin categoria)."); return; }
  const arr = parseJsonArray(raw);
  if (!arr) { console.log("La IA no devolvio JSON valido; no se toca nada."); return; }

  const valid = new Map<number, string>();
  for (const item of arr) {
    const i = Number(item?.i);
    const cat = String(item?.category ?? "").trim();
    if (!Number.isInteger(i) || i < 0 || i >= todo.length) continue;
    if (isSinCat(cat)) continue; // sin sugerencia -> no aplicar
    if (!validFor(todo[i].direction).has(cat)) continue; // categoria fuera de lista o tipo equivocado -> descartar
    valid.set(i, cat);
  }

  console.log(`\nSugerencias validas: ${valid.size}/${todo.length}`);
  for (let i = 0; i < todo.length; i++) {
    const m = todo[i];
    console.log(`  [${i}] ${m.direction} $${Number(m.amount).toLocaleString("es-CL")} ${String(m.description).slice(0, 40)} -> ${valid.get(i) ?? "(sin sugerencia)"}`);
  }

  if (DRY) { console.log("\n[DRY] no se escribio nada."); return; }

  const batch = writeBatch(db);
  let applied = 0;
  for (let i = 0; i < todo.length; i++) {
    const m = todo[i];
    const cat = valid.get(i);
    const patch: Record<string, unknown> = cat
      ? { suggestedCategory: cat, confidence: AI_CONFIDENCE, notes: `${AI_MARK} sugerido: ${cat}`, updatedAt: NOW }
      : { notes: `${AI_MARK} sin sugerencia`, updatedAt: NOW }; // marca para no re-preguntar
    batch.update(doc(db, "importedMovements", m.id), patch);
    if (cat) applied++;
  }
  await batch.commit();
  console.log(`\nIA aplico ${applied} categorias (confianza ${AI_CONFIDENCE}, fuera del clic masivo). El resto quedo marcado sin sugerencia.`);
}
main().catch((e) => { console.error("ERROR (best-effort, no bloquea):", e?.message ?? e); process.exit(0); });
