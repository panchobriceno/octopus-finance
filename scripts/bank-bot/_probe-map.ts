import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";

function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: process.env.VITE_FIREBASE_API_KEY!, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!, projectId: process.env.VITE_FIREBASE_PROJECT_ID!, storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET!, messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!, appId: process.env.VITE_FIREBASE_APP_ID! }));

(async () => {
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as any).filter((t) => (t.status ?? "paid") !== "cancelled");
  // Agrupar por fuente (card o account) -> workspace + categorias
  const groups: Record<string, { ws: Record<string, number>; cats: Record<string, number> }> = {};
  for (const t of txs) {
    const key = t.creditCardName ? `card:${t.creditCardName}` : (t.accountId ? `acct:${t.accountId}` : "sin-fuente");
    groups[key] ??= { ws: {}, cats: {} };
    groups[key].ws[t.workspace ?? "null"] = (groups[key].ws[t.workspace ?? "null"] ?? 0) + 1;
    groups[key].cats[`${t.type}:${t.category}`] = (groups[key].cats[`${t.type}:${t.category}`] ?? 0) + 1;
  }
  for (const [k, g] of Object.entries(groups)) {
    const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n}(${c})`).join(", ");
    console.log(`\n${k}\n   ws: ${top(g.ws)}\n   cats: ${top(g.cats)}`);
  }
})();
