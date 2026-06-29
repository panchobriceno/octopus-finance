/**
 * Reglas/categorias MANUALES a partir de correcciones del usuario en la bandeja.
 * Estas NO las toca el generador automatico (generate-rules borra solo las suyas por nota
 * exacta; estas llevan otra nota, y ademas generate-rules respeta keywords de reglas no-bot).
 *
 * Correcciones 2026-06-29:
 *  - "previred"  -> categoria nueva "Previred" (gasto, business). Auto (priority 5).
 *  - "servipag"  -> "Gastos Básicos" (gasto, FAMILY: luz/agua/internet/gas del hogar, aunque
 *    se paguen desde la cuenta Santander OM -> la regla pisa el ambito a family a proposito).
 *    Auto (priority 5): el usuario confirmo que Servipag es SIEMPRE familia.
 *
 * Correr:  npx tsx scripts/bank-bot/add-manual-rules.ts --dry
 *          npx tsx scripts/bank-bot/add-manual-rules.ts
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { addDoc, collection, getDocs, getFirestore } from "firebase/firestore/lite";
import type { Category, MovementRule } from "../../shared/schema";

const DRY = process.argv.includes("--dry");
const NOW = new Date().toISOString();
const NOTE = "Manual (correccion usuario 2026-06-29)";
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

// Categorias a asegurar (name, type, workspace)
const CATS = [
  { name: "Previred", type: "expense", workspace: "business" },
  { name: "Gastos Básicos", type: "expense", workspace: "family" },
  { name: "Facebook Ads", type: "expense", workspace: "business" }, // mayor gasto internacional, sin categoria antes
];
// Reglas a asegurar (1 keyword c/u, source-consistente, amountDirection explicito)
const RULES = [
  { keyword: "previred", category: "Previred", workspace: "business", movementType: "expense", paymentMethod: "bank_account", amountDirection: "expense", priority: 5 },
  { keyword: "servipag", category: "Gastos Básicos", workspace: "family", movementType: "expense", paymentMethod: "bank_account", amountDirection: "expense", priority: 5 },
  { keyword: "facebk", category: "Facebook Ads", workspace: "business", movementType: "expense", paymentMethod: "credit_card", amountDirection: "expense", priority: 5 }, // cargos "FACEBK *..." en la tarjeta
];

async function main() {
  const cats = (await getDocs(collection(db, "categories"))).docs.map((d) => d.data() as Category);
  const rules = (await getDocs(collection(db, "movementRules"))).docs.map((d) => d.data() as MovementRule);
  const catExists = (name: string, type: string, ws: string) => cats.some((c) => norm(c.name) === norm(name) && c.type === type && (c.workspace ?? "") === ws);
  const ruleExists = (kw: string) => rules.some((r) => (r.keywords || []).some((k) => norm(k) === norm(kw)));

  const newCats = CATS.filter((c) => !catExists(c.name, c.type, c.workspace));
  const newRules = RULES.filter((r) => !ruleExists(r.keyword));

  console.log(`${DRY ? "[DRY] " : ""}Categorias nuevas: ${newCats.length}`);
  for (const c of newCats) console.log(`  + ${c.name} (${c.type} / ${c.workspace})`);
  console.log(`Reglas nuevas: ${newRules.length}`);
  for (const r of newRules) console.log(`  + "${r.keyword}" -> ${r.category} / ${r.workspace} / ${r.amountDirection} [conf ${85}]`);
  if (CATS.length - newCats.length) console.log(`(categorias ya existentes, se omiten: ${CATS.length - newCats.length})`);
  if (RULES.length - newRules.length) console.log(`(reglas con esa keyword ya existen, se omiten: ${RULES.length - newRules.length})`);

  if (DRY) { console.log("\n(no se escribio nada)"); return; }
  for (const c of newCats) await addDoc(collection(db, "categories"), { name: c.name, type: c.type, workspace: c.workspace, color: c.type === "income" ? "#10b981" : "#64748b" });
  for (const r of newRules) await addDoc(collection(db, "movementRules"), { name: `Manual: ${r.keyword}`, keywords: [r.keyword], category: r.category, workspace: r.workspace, movementType: r.movementType, paymentMethod: r.paymentMethod, accountId: null, creditCardName: null, amountDirection: r.amountDirection, priority: r.priority, isActive: true, notes: NOTE, createdAt: NOW, updatedAt: NOW });
  console.log(`\nCreadas ${newCats.length} categorias y ${newRules.length} reglas.`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
