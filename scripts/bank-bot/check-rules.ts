import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
import type { Transaction, MovementRule, Category, Item } from "../../shared/schema";

function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

async function main() {
  const rules = (await getDocs(collection(db, "movementRules"))).docs.map((d) => d.data() as MovementRule);
  const cats = (await getDocs(collection(db, "categories"))).docs.map((d) => d.data() as Category);
  const items = (await getDocs(collection(db, "items"))).docs.map((d) => d.data() as Item);
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as Transaction);

  console.log(`movementRules: ${rules.length}`);
  rules.slice(0, 20).forEach((r) => console.log(`  [${r.keywords?.join(", ")}] -> cat:${r.category} ws:${r.workspace} ${r.movementType}`));

  console.log(`\ncategories: ${cats.length} | items: ${items.length} | transactions: ${txs.length}`);
  const withCat = txs.filter((t) => t.category && t.category !== "Sin categoría" && t.category !== "Sin categoria");
  console.log(`transacciones con categoria real: ${withCat.length}`);

  // muestra de como categoriza por comercio
  const probe = ["uber", "decathlon", "aramco", "adobe", "linkedin", "mercadopago", "google", "previred", "s.i.i", "entel"];
  console.log("\nEjemplos de categorizacion historica:");
  for (const term of probe) {
    const hit = withCat.find((t) => (t.name || "").toLowerCase().includes(term));
    if (hit) console.log(`  "${term}" -> name:"${hit.name}" cat:${hit.category} ws:${hit.workspace} item:${hit.itemId ?? "-"}`);
  }
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
