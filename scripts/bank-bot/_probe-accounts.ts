import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";

function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: process.env.VITE_FIREBASE_API_KEY!, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!, projectId: process.env.VITE_FIREBASE_PROJECT_ID!, storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET!, messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!, appId: process.env.VITE_FIREBASE_APP_ID! }));

(async () => {
  const accts = (await getDocs(collection(db, "accounts"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  console.log("=== CUENTAS ===");
  for (const a of accts) console.log(`  id=${a.id} | name=${JSON.stringify(a.name)} type=${a.type} bank=${a.bankName ?? a.bank ?? "-"} workspace=${a.workspace ?? "-"} card=${a.creditCardName ?? "-"}`);

  const rules = (await getDocs(collection(db, "movementRules"))).docs.map((d) => d.data() as any);
  console.log(`\n=== REGLAS actuales: ${rules.length} ===`);
  for (const r of rules.slice(0, 30)) console.log(`  [${r.keywords?.join(",")}] -> cat=${r.category} ws=${r.workspace} acct=${r.accountId ?? "-"} card=${r.creditCardName ?? "-"} prio=${r.priority} dir=${r.amountDirection}`);

  // Aprender del historial: por cada (categoria) ver workspace/account/card mas usado
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as any).filter((t) => (t.status ?? "paid") !== "cancelled");
  console.log(`\n=== TRANSACCIONES: ${txs.length} ===`);
  const wsCount: Record<string, number> = {}; const acctCount: Record<string, number> = {}; const cardCount: Record<string, number> = {};
  for (const t of txs) { wsCount[t.workspace ?? "null"] = (wsCount[t.workspace ?? "null"] ?? 0) + 1; acctCount[t.accountId ?? "null"] = (acctCount[t.accountId ?? "null"] ?? 0) + 1; cardCount[t.creditCardName ?? "null"] = (cardCount[t.creditCardName ?? "null"] ?? 0) + 1; }
  console.log("workspace:", wsCount);
  console.log("accountId:", acctCount);
  console.log("creditCardName:", cardCount);
  // categorias distintas
  const cats = [...new Set(txs.map((t) => `${t.type}:${t.category}`))].sort();
  console.log(`\n=== CATEGORIAS usadas (${cats.length}) ===`); console.log(cats.join("  |  "));
})();
