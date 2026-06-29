import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: process.env.VITE_FIREBASE_API_KEY!, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!, projectId: process.env.VITE_FIREBASE_PROJECT_ID!, storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET!, messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!, appId: process.env.VITE_FIREBASE_APP_ID! }));
(async () => {
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const bot = movs.filter((m) => /bank-bot/i.test(m.sourceName ?? "") || /edwmail_|sanmail_/.test(m.id));
  console.log(`=== importedMovements del bot: ${bot.length} ===`);
  const byStatus: Record<string, number> = {};
  for (const m of bot) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
  console.log("por status:", byStatus);
  for (const m of bot) console.log(`  [${m.status}] ${m.date} $${Number(m.amount).toLocaleString("es-CL")} ${m.description?.slice(0,40)} | card=${m.creditCardName ?? "-"} acct=${m.accountId ?? "-"}`);

  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const phantom = txs.filter((t) => t.creditCardName === "Edwards Visa ****7232");
  console.log(`\n=== transacciones con tarjeta fantasma "Edwards Visa ****7232": ${phantom.length} ===`);
  for (const t of phantom) console.log(`  ${t.date} $${Number(t.amount).toLocaleString("es-CL")} ${t.name?.slice(0,40)} | ws=${t.workspace}`);
})();
