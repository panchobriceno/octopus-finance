/**
 * F3 — catch-up de categorización de TRANSACCIONES históricas (Sin categoría / Otros).
 * Determinista primero (TASA INT → Intereses; reglas curadas → categoría+subcategoría+ámbito),
 * IA para el resto (SOLO categoría, patrón categorize-ai).
 *
 * Política (tras review de Codex — las transacciones son la fuente de verdad de reportes):
 *  - IA: SOLO categoría. NUNCA cambia el ámbito. itemId = null. Elige de la lista blanca; valida tipo.
 *  - Reglas: categoría + subcategoría + ÁMBITO (curadas). Cambios de ámbito marcados "⇄ ÁMBITO".
 *  - "TASA INT" = interés de cuota → Intereses bancarios (determinista, no IA, no keyword del comercio).
 *  - La IA es no-determinista: el DRY-RUN guarda las propuestas en _propuestas-historicos.json y
 *    --apply aplica EXACTAMENTE eso (no vuelve a llamar la IA) → lo aplicado == lo revisado.
 *  - --apply escribe un BACKUP antes de tocar nada. Restaurable con restore-historicos.ts.
 *  - NO agrega campos nuevos a las transacciones. Procedencia = propuestas/backup.
 *
 * Correr:  npx tsx scripts/bank-bot/categorize-historicos.ts            (dry-run: calcula + guarda propuestas)
 *          npx tsx scripts/bank-bot/categorize-historicos.ts --apply    (aplica las propuestas guardadas + backup)
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { collection, doc, getDocs, writeBatch, type Firestore } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";
import type { Category, Item, MovementRule, Transaction, ImportedMovement } from "../../shared/schema";
import { findBestMovementRule } from "../../client/src/domain/bank-imports";
import { sanitizeRuleItemId } from "../../client/src/domain/movement-rules";

const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const CLAUDE_BIN = path.join(os.homedir(), ".npm-global/bin/claude");
const CHUNK = 400;
const DIR = path.join(process.cwd(), "scripts", "bank-bot");
const PROPOSALS_PATH = path.join(DIR, "_propuestas-historicos.json");
const INTERESES = "Intereses bancarios";

const norm = (c: unknown) => String(c ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const isSinCat = (c: unknown) => { const n = norm(c); return n === "" || n === "sin categoria"; };
const isTarget = (c: unknown) => isSinCat(c) || norm(c) === "otros";
const isTasaInt = (name: unknown) => norm(name).includes("tasa int");

function callClaude(prompt: string): string | null {
  try {
    const out = execFileSync(CLAUDE_BIN, ["-p", "--output-format", "json", "--max-turns", "1"], { input: prompt, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    try { const env = JSON.parse(out); if (env && typeof env.result === "string") return env.result; } catch { /* no es sobre */ }
    return out;
  } catch (e: any) { console.error("IA no disponible (best-effort, se omite):", e?.message ?? e); return null; }
}
function parseJsonArray(text: string): any[] | null {
  const start = text.indexOf("["); if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true; else if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { try { const a = JSON.parse(text.slice(start, i + 1)); return Array.isArray(a) ? a : null; } catch { return null; } } }
  }
  return null;
}
async function commitChunked(db: Firestore, ups: { id: string; patch: Record<string, unknown> }[]) {
  for (let off = 0; off < ups.length; off += CHUNK) {
    const b = writeBatch(db);
    for (const u of ups.slice(off, off + CHUNK)) b.update(doc(db, "transactions", u.id), u.patch);
    await b.commit();
  }
}

type Proposal = {
  id: string; name: string; date: string; amount: number;
  oldCategory: string; oldWorkspace: string | null; oldItemId: string | null;
  category: string; workspace: string; itemId: string | null;
  source: "regla" | "ia"; wsChange: boolean;
};

async function runApply(db: Firestore) {
  if (!fs.existsSync(PROPOSALS_PATH)) { console.error(`\nNo hay propuestas guardadas (${PROPOSALS_PATH}). Corré primero el dry-run (sin --apply).\n`); process.exit(1); }
  const proposals = JSON.parse(fs.readFileSync(PROPOSALS_PATH, "utf8")) as Proposal[];
  if (!Array.isArray(proposals) || proposals.length === 0) { console.error("Propuestas vacías."); process.exit(1); }

  // Re-leer estado actual para respaldar y validar que sigan siendo objetivo (no cambiaron desde el dry-run).
  const txById = new Map((await getDocs(collection(db, "transactions"))).docs.map((d) => [d.id, d.data() as Transaction]));
  const backup: { id: string; category: string; workspace: string | null; itemId: string | null }[] = [];
  const ups: { id: string; patch: Record<string, unknown> }[] = [];
  let skipped = 0;
  for (const p of proposals) {
    const cur = txById.get(p.id);
    // Omitir si ya no es objetivo o si el ámbito cambió desde el dry-run (fue editado a mano →
    // aplicar el ámbito congelado revertiría esa corrección). Se re-corre el dry-run y listo.
    if (!cur || !isTarget(cur.category) || (cur.workspace ?? null) !== p.oldWorkspace) { skipped++; continue; }
    backup.push({ id: p.id, category: cur.category, workspace: cur.workspace ?? null, itemId: cur.itemId ?? null });
    ups.push({ id: p.id, patch: { category: p.category, workspace: p.workspace, itemId: p.itemId, updatedAt: NOW } });
  }
  if (ups.length === 0) { console.log("\nNada por aplicar (todas cambiaron desde el dry-run).\n"); return; }

  const backupPath = path.join(DIR, `_backup-historicos-${NOW.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBackup: ${path.basename(backupPath)}`);
  await commitChunked(db, ups);
  fs.rmSync(PROPOSALS_PATH, { force: true }); // consumidas
  console.log(`✅ Aplicadas ${ups.length} categorías${skipped ? ` (${skipped} omitidas: cambiaron desde el dry-run)` : ""}.`);
  console.log(`Revertir: npx tsx scripts/bank-bot/restore-historicos.ts ${path.basename(backupPath)}\n`);
}

async function runDry(db: Firestore) {
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => ({ id: d.id, ...(d.data() as Transaction) }))
    .filter((t) => (t.status ?? "paid") !== "cancelled" && (t.subtype ?? "actual") === "actual" && isTarget(t.category));
  const categories = (await getDocs(collection(db, "categories"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Category[];
  const items = (await getDocs(collection(db, "items"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Item[];
  const rules = (await getDocs(collection(db, "movementRules"))).docs.map((d) => ({ id: d.id, ...(d.data() as MovementRule) })).filter((r) => r.isActive !== false);

  const byType: Record<string, Set<string>> = { income: new Set(), expense: new Set() };
  for (const c of categories) { const t = c.type === "income" ? "income" : "expense"; if (c.name && !isTarget(c.name)) byType[t].add(c.name); }
  const validFor = (dir: string) => byType[dir === "income" ? "income" : "expense"];
  const interesesOk = byType.expense.has(INTERESES);

  console.log(`\nTransacciones objetivo (Sin categoría/Otros): ${txs.length}\n`);
  const proposals: Proposal[] = [];
  const remaining: (Transaction & { id: string })[] = [];
  const base = (tx: Transaction & { id: string }) => ({ id: tx.id, name: tx.name, date: tx.date, amount: Number(tx.amount) || 0, oldCategory: tx.category, oldWorkspace: tx.workspace ?? null, oldItemId: tx.itemId ?? null });

  // ── Fase 1: determinista ──
  for (const tx of txs) {
    // TASA INT = interés de cuota → Intereses bancarios. No es el comercio. PRESERVA el ámbito de
    // origen (un interés del negocio, ej. SII, NO debe moverse a family — corrompería el split).
    if (isTasaInt(tx.name) && tx.type !== "income" && interesesOk) {
      const ws = tx.workspace ?? "family";
      proposals.push({ ...base(tx), category: INTERESES, workspace: ws, itemId: null, source: "regla", wsChange: (tx.workspace ?? "") !== ws });
      continue;
    }
    const direction = tx.type === "income" ? "income" : "expense";
    const movementLike = { description: tx.name, rawDescription: tx.name, sourceName: "", bankName: "", creditCardName: tx.creditCardName ?? "", direction, amount: Math.abs(Number(tx.amount) || 0) } as unknown as ImportedMovement;
    const rule = findBestMovementRule(movementLike, rules);
    if (rule && !isTarget(rule.category)) {
      const workspace = rule.workspace || tx.workspace || "family";
      const itemId = sanitizeRuleItemId(categories, items, rule.category, rule.movementType, workspace, rule.itemId ?? null);
      proposals.push({ ...base(tx), category: rule.category, workspace, itemId, source: "regla", wsChange: (tx.workspace ?? "") !== workspace });
    } else remaining.push(tx);
  }

  // ── Fase 2: IA (solo categoría; ámbito NO se toca) ──
  if (remaining.length > 0) {
    const expenseList = [...byType.expense].sort();
    const incomeList = [...byType.income].sort();
    const lines = remaining.map((t, i) => `[${i}] ${t.type === "income" ? "ingreso" : "gasto"} ámbito:${t.workspace ?? "?"} $${Number(t.amount).toLocaleString("es-CL")} — "${String(t.name ?? "").slice(0, 80)}"`);
    const prompt = [
      "Sos el categorizador de transacciones de Pancho (dueño de la agencia 'Octopus Media' + gastos personales/familia). Para CADA transacción elegí SOLO la MEJOR categoría de la lista (NO cambies el ámbito, ya viene dado).",
      "Si ninguna categoría calza con claridad dejá \"Sin categoria\". NO inventes. Respetá el tipo: un GASTO solo lleva categoría de gasto; un INGRESO solo de ingreso.",
      "Ojo: 'MERCADOPAGO*<comercio>' es una pasarela (mirá el comercio real que sigue). Compras online (MercadoLibre, Shein, AliExpress, Amazon no-Prime) → 'Compras Online' si existe.",
      "",
      `Categorías de GASTO válidas: ${expenseList.join(" | ")}`,
      `Categorías de INGRESO válidas: ${incomeList.join(" | ")}`,
      "",
      "Transacciones:", ...lines, "",
      "Respondé para CADA una (no omitas). SOLO un array JSON, sin texto adicional:",
      '[{"i":0,"category":"<categoría exacta o Sin categoria>"}, ...]',
    ].join("\n");
    console.log(`Llamando a la IA para ${remaining.length} transacciones sin regla...`);
    const raw = callClaude(prompt);
    const arr = raw ? parseJsonArray(raw) : null;
    if (!arr) console.log("IA sin respuesta usable; esas quedan sin sugerencia.");
    else {
      const answered = new Map<number, string>();
      for (const it of arr) { const i = Number(it?.i); if (Number.isInteger(i) && i >= 0 && i < remaining.length && typeof it?.category === "string") answered.set(i, it.category.trim()); }
      for (let i = 0; i < remaining.length; i++) {
        const cat = answered.get(i); if (!cat) continue;
        const tx = remaining[i];
        if (!isTarget(cat) && validFor(tx.type).has(cat)) proposals.push({ ...base(tx), category: cat, workspace: tx.workspace ?? "family", itemId: null, source: "ia", wsChange: false });
      }
    }
  }

  // ── Salida + guardar propuestas ──
  const bySource = (s: string) => proposals.filter((p) => p.source === s);
  const print = (p: Proposal) => {
    const sub = p.itemId ? ` › ${items.find((i) => i.id === p.itemId)?.name ?? "?"}` : "";
    const ws = p.wsChange ? `  ⇄ ÁMBITO ${p.oldWorkspace ?? "?"}→${p.workspace}` : "";
    console.log(`  ${p.date} $${p.amount.toLocaleString("es-CL").padStart(9)} | ${String(p.name).slice(0, 40).padEnd(40)} | ${p.oldCategory} → ${p.category}${sub}${ws}`);
  };
  console.log(`\n=== POR REGLA / DETERMINISTA (${bySource("regla").length}) ===`); bySource("regla").forEach(print);
  console.log(`\n=== POR IA (${bySource("ia").length}, solo categoría) ===`); bySource("ia").forEach(print);
  const wsChanges = proposals.filter((p) => p.wsChange).length;
  console.log(`\nRESUMEN: ${proposals.length}/${txs.length} propuestas (${bySource("regla").length} regla · ${bySource("ia").length} IA) · ${txs.length - proposals.length} sin sugerencia · ${wsChanges} cambian ámbito`);

  fs.writeFileSync(PROPOSALS_PATH, JSON.stringify(proposals, null, 2));
  console.log(`\n[DRY-RUN] propuestas guardadas en ${path.basename(PROPOSALS_PATH)}. Revisá y aplicá con --apply (aplica exactamente esto).\n`);
}

(async () => {
  const db = await getAuthedDb();
  if (APPLY) await runApply(db); else await runDry(db);
})().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
