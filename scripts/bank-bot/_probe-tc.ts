import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: process.env.VITE_FIREBASE_API_KEY!, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!, projectId: process.env.VITE_FIREBASE_PROJECT_ID!, storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET!, messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!, appId: process.env.VITE_FIREBASE_APP_ID! }));
const RX = /adobe|linkedin|facebk|facebook|google|youtube|workspace|cloud|interes|impuesto|iva uso|servicio uso|comision de manten/i;
(async () => {
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const hit = movs.filter((m) => RX.test(String(m.description ?? "")) || String(m.creditCardName ?? "").includes("6101"));
  console.log(`Movimientos (cualquier status) que matchean tarjeta 6101 / esos comercios: ${hit.length}`);
  for (const m of hit) console.log(`  [${m.status}] ${m.date} $${Number(m.amount).toLocaleString("es-CL")} "${String(m.description).slice(0,35)}" card=${m.creditCardName ?? "-"} src=${m.source} cat=${m.suggestedCategory}`);
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as any);
  const thit = txs.filter((t) => RX.test(String(t.name ?? "")) || String(t.creditCardName ?? "").includes("6101"));
  console.log(`\nTransacciones que matchean: ${thit.length}`);
  for (const t of thit) console.log(`  ${t.date} $${Number(t.amount).toLocaleString("es-CL")} "${String(t.name).slice(0,35)}" card=${t.creditCardName ?? "-"}`);
})();
