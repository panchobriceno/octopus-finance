import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: process.env.VITE_FIREBASE_API_KEY!, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!, projectId: process.env.VITE_FIREBASE_PROJECT_ID!, storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET!, messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!, appId: process.env.VITE_FIREBASE_APP_ID! }));
(async () => {
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as any).filter((t) => Number(t.amount) === 3000000);
  console.log(`Transacciones de $3.000.000 en tus libros: ${txs.length}`);
  for (const t of txs) console.log(`  ${t.date} ${t.type}/${t.movementType ?? "-"} ${String(t.name).slice(0,45)} | ws=${t.workspace} acct=${t.accountId ?? "-"} dest=${t.destinationAccountId ?? "-"}`);
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((m) => Number(m.amount) === 3000000);
  console.log(`\nMovimientos de $3.000.000 en la bandeja: ${movs.length}`);
  for (const m of movs) console.log(`  [${m.status}] ${m.date} ${m.direction} ${String(m.description).slice(0,45)} -> ${m.suggestedCategory} | id=${m.id}`);
})();
