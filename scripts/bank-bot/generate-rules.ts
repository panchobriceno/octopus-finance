/**
 * Genera MovementRules desde el historial categorizado de Pancho (v2).
 *
 * Por que v2 (cambios tras revision de Codex + Paso 1 de identidad de fuente):
 * - applyMovementRule SIEMPRE pisa suggestedWorkspace/movementType/paymentMethod con los de la
 *   regla. Por eso cada regla debe traer esos campos CONSISTENTES con la fuente del comercio,
 *   o pisaria el ambito/metodo que fija la identidad de fuente. Emitimos regla solo cuando la
 *   tupla (categoria, workspace, paymentMethod, movementType) es dominante y consistente.
 * - priority 5 -> ruleConfidence = 76 + 1*4 + 5 = 85 (umbral para "confiables"). 1 keyword por
 *   regla a proposito: la confianza usa el total de keywords (no las que matchean), 1 evita inflarla.
 * - Excluimos "Otros"/"Sin categoria": la conversion las bloquea igual, una regla asi no sirve.
 * - accountId/creditCardName quedan null en la regla: applyMovementRule solo los pisa si la regla
 *   los trae, asi respeta los que fijo la identidad de fuente (cuenta OM / tarjeta real).
 *
 * Correr:  npx tsx scripts/bank-bot/generate-rules.ts --dry   (muestra, no escribe)
 *          npx tsx scripts/bank-bot/generate-rules.ts         (regenera reglas bot en la app)
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { addDoc, collection, deleteDoc, doc, getDocs, getFirestore } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";
import type { Transaction, MovementRule } from "../../shared/schema";

const DRY = process.argv.includes("--dry");
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = await getAuthedDb();

const STOP = new Set(["pago", "pagos", "compra", "compras", "comp", "nacional", "internacional", "transf", "transferencia", "de", "del", "la", "el", "con", "por", "en", "linea", "automatico", "automatica", "tarjeta", "credito", "cuenta", "spa", "ltda", "limitada", "limit", "plan", "mantencion", "sociedad", "monto", "cancelado", "traspaso", "deuda", "cargo", "abono", "com", "mp", "payu", "pat", "servicio", "uso", "marc", "asistido", "tasa", "int", "santiago", "condes", "las", "plaza", "mall", "trebo", "pcs", "inc", "centro", "chile", "sa", "eirl", "dl", "admin", "mensual", "corriente", "corr", "pap"]);
const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const toks = (s: string) => norm(s).split(" ").filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));

// Categorias que NO sirven para autoconversion (la conversion las manda a revision igual).
const isRealCategory = (c: string) => {
  const n = norm(c);
  return n !== "" && n !== "otros" && n !== "sin categoria";
};
const pmOf = (t: Transaction) => (t as any).paymentMethod ?? (t.creditCardName ? "credit_card" : "bank_account");
const mtOf = (t: Transaction) => (t as any).movementType ?? (t.type === "income" ? "income" : "expense");

async function main() {
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as Transaction)
    .filter((t) => isRealCategory(t.category) && (t.status ?? "paid") !== "cancelled");
  const existing = (await getDocs(collection(db, "movementRules"))).docs.map((d) => ({ id: d.id, ...(d.data() as MovementRule) }));
  // Reglas creadas por el bot (regenerables), identificadas por NOTA EXACTA (no regex laxo,
  // que podria borrar una regla del usuario que mencione "bank-bot"). Las del usuario NO se tocan.
  const BOT_NOTES = new Set(["Generada desde historial por bank-bot", "Generada desde historial por bank-bot v2"]);
  const isBot = (r: { notes?: string | null }) => BOT_NOTES.has((r.notes ?? "").trim());
  const botRules = existing.filter(isBot);
  const userKw = new Set(existing.filter((r) => !isBot(r)).flatMap((r) => (r.keywords || []).map((k) => k.toLowerCase())));

  // token -> tuplas (cat|ws|pm|mt) con conteo
  const map = new Map<string, Map<string, number>>();
  const keyOf = (cat: string, ws: string, pm: string, mt: string) => `${cat}|||${ws}|||${pm}|||${mt}`;
  for (const t of txs) {
    const tuple = keyOf(t.category, t.workspace ?? "family", pmOf(t), mtOf(t));
    for (const w of new Set(toks(t.name))) {
      if (userKw.has(w)) continue; // no pisar reglas del usuario
      if (!map.has(w)) map.set(w, new Map());
      map.get(w)!.set(tuple, (map.get(w)!.get(tuple) || 0) + 1);
    }
  }

  type Rule = { keyword: string; category: string; workspace: string; paymentMethod: string; movementType: string; amountDirection: string; n: number; share: number; priority: number };
  const rules: Rule[] = [];
  for (const [kw, tuples] of map) {
    const total = [...tuples.values()].reduce((a, b) => a + b, 0);
    if (total < 2) continue; // solo comercios recurrentes
    const sorted = [...tuples.entries()].sort((a, b) => b[1] - a[1]);
    const [topTuple, topN] = sorted[0];
    if (sorted.length > 1 && sorted[1][1] === topN) continue; // empate de tupla -> ambiguo
    const share = topN / total;
    if (share < 0.6) continue; // tupla no dominante -> comercio cruza fuente/categoria, riesgoso
    const [category, workspace, paymentMethod, movementType] = topTuple.split("|||");
    // Direccion explicita: evita que la regla matchee un movimiento de la direccion opuesta
    // (los loaders filtran reglas por amountDirection antes de aplicarlas).
    const amountDirection = movementType === "income" ? "income" : "expense";
    // Senal fuerte (n>=3) -> priority 5 -> confianza 85 -> entra al clic "confiables".
    // Senal debil (n==2) -> priority 0 -> confianza 80 -> SOLO sugiere, no autoconvierte.
    const priority = total >= 3 ? 5 : 0;
    rules.push({ keyword: kw, category, workspace, paymentMethod, movementType, amountDirection, n: total, share, priority });
  }
  rules.sort((a, b) => b.n - a.n || a.keyword.localeCompare(b.keyword));

  console.log(`\n${DRY ? "[DRY] " : ""}Reglas bot existentes a reemplazar: ${botRules.length}`);
  console.log(`Reglas nuevas a crear: ${rules.length} (de ${txs.length} tx con categoria real, ${map.size} comercios)\n`);
  for (const r of rules) console.log(`  "${r.keyword}" (x${r.n}, ${Math.round(r.share * 100)}%) [conf ${r.priority === 5 ? 85 : 80}] -> ${r.category} / ${r.workspace} / ${r.paymentMethod} / ${r.amountDirection}`);

  if (DRY) { console.log("\n(no se escribio nada — saca --dry para regenerar)"); return; }

  // Borrar reglas bot viejas y recrear (las del usuario quedan intactas).
  for (const r of botRules) await deleteDoc(doc(db, "movementRules", r.id));
  const now = new Date().toISOString();
  for (const r of rules) {
    await addDoc(collection(db, "movementRules"), {
      name: `Auto: ${r.keyword}`,
      keywords: [r.keyword],
      category: r.category,
      workspace: r.workspace,
      movementType: r.movementType,
      paymentMethod: r.paymentMethod,
      accountId: null,
      creditCardName: null,
      amountDirection: r.amountDirection,
      priority: r.priority, // 5 (n>=3) -> conf 85 (confiables) | 0 (n==2) -> conf 80 (solo sugiere)
      isActive: true,
      notes: "Generada desde historial por bank-bot v2",
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`\nBorradas ${botRules.length} reglas bot viejas, creadas ${rules.length} nuevas (editables en la app).`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
