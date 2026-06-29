/**
 * Genera MovementRules a partir del historial categorizado de Pancho.
 * Toma comercios que se repiten (>=2 transacciones) con categoria mayoritaria clara
 * y crea una regla por comercio. Las reglas quedan editables en la app y las usa
 * tanto la importacion manual como el bot.
 *
 * Correr:  npx tsx scripts/bank-bot/generate-rules.ts --dry   (muestra)
 *          npx tsx scripts/bank-bot/generate-rules.ts         (crea en la app)
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { addDoc, collection, getDocs, getFirestore } from "firebase/firestore/lite";
import type { Transaction, MovementRule } from "../../shared/schema";

const DRY = process.argv.includes("--dry");
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

const STOP = new Set(["pago", "pagos", "compra", "compras", "comp", "nacional", "internacional", "transf", "transferencia", "de", "del", "la", "el", "con", "por", "en", "linea", "automatico", "automatica", "tarjeta", "credito", "cuenta", "spa", "ltda", "limitada", "limit", "plan", "mantencion", "sociedad", "monto", "cancelado", "traspaso", "deuda", "cargo", "abono", "com", "mp", "payu", "pat", "servicio", "uso", "marc", "asistido", "tasa", "int", "santiago", "condes", "las", "plaza", "mall", "trebo", "pcs", "inc", "centro", "chile", "sa", "eirl", "dl", "admin", "mensual", "corriente", "corr", "pap"]);
const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const toks = (s: string) => norm(s).split(" ").filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));

async function main() {
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as Transaction)
    .filter((t) => t.category && t.category !== "Sin categoría" && t.category !== "Sin categoria");
  const existing = (await getDocs(collection(db, "movementRules"))).docs.map((d) => d.data() as MovementRule);
  const existingKw = new Set(existing.flatMap((r) => (r.keywords || []).map((k) => k.toLowerCase())));

  // token -> lista de {category, workspace, movementType}
  const map = new Map<string, { category: string; workspace: string; movementType: string }[]>();
  for (const t of txs) {
    const mt = t.movementType ?? (t.type === "income" ? "income" : "expense");
    for (const w of new Set(toks(t.name))) {
      if (!map.has(w)) map.set(w, []);
      map.get(w)!.push({ category: t.category, workspace: t.workspace ?? "family", movementType: mt });
    }
  }

  type Rule = { keyword: string; category: string; workspace: string; movementType: string; n: number };
  const rules: Rule[] = [];
  for (const [kw, list] of map) {
    if (list.length < 2) continue;            // solo comercios recurrentes
    if (existingKw.has(kw)) continue;          // no duplicar reglas existentes
    // categoria mayoritaria
    const tally = new Map<string, number>();
    for (const e of list) tally.set(e.category, (tally.get(e.category) || 0) + 1);
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) continue; // empate -> ambiguo, skip
    const cat = sorted[0][0];
    const sample = list.find((e) => e.category === cat)!;
    rules.push({ keyword: kw, category: cat, workspace: sample.workspace, movementType: sample.movementType, n: list.length });
  }
  rules.sort((a, b) => b.n - a.n || a.keyword.localeCompare(b.keyword));

  console.log(`\n${DRY ? "[DRY] " : ""}Reglas a crear: ${rules.length} (de ${txs.length} transacciones, ${map.size} comercios)\n`);
  for (const r of rules) console.log(`  "${r.keyword}" (x${r.n}) -> ${r.category} / ${r.workspace} / ${r.movementType}`);

  if (DRY) { console.log("\n(no se creo nada — saca --dry para guardar)"); return; }

  const now = new Date().toISOString();
  for (const r of rules) {
    await addDoc(collection(db, "movementRules"), {
      name: `Auto: ${r.keyword}`,
      keywords: [r.keyword],
      category: r.category,
      workspace: r.workspace,
      movementType: r.movementType,
      paymentMethod: "bank_account",
      accountId: null,
      creditCardName: null,
      amountDirection: "any",
      priority: 0,
      isActive: true,
      notes: "Generada desde historial por bank-bot",
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`\nCreadas ${rules.length} reglas en la app (editables en la seccion de reglas).`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
