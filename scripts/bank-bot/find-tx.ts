import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";
import type { Transaction, ImportedMovement } from "../../shared/schema";

function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = await getAuthedDb();

const term = (process.argv[2] || "aramco").toLowerCase();

async function main() {
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => ({ id: d.id, ...(d.data() as Transaction) }));
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }));

  const matchTx = txs.filter((t) => (t.name || "").toLowerCase().includes(term) || (t.category || "").toLowerCase().includes(term));
  console.log(`\n=== TRANSACTIONS con "${term}" (${matchTx.length}) ===`);
  for (const t of matchTx.sort((a, z) => (a.date < z.date ? 1 : -1))) {
    console.log(`  ${t.date} | $${Number(t.amount).toLocaleString("es-CL")} | ${t.name} | cat:${t.category} | ws:${t.workspace} | ${t.importBatchId ? "importado(" + t.importBatchId.slice(0, 6) + ")" : "manual"} | status:${t.status} | id:${t.id.slice(0, 8)}`);
  }

  const amt = Number(process.argv[3]);
  if (Number.isFinite(amt)) {
    const sameAmt = txs.filter((t) => Number(t.amount) === amt);
    console.log(`\n=== TRANSACTIONS con monto $${amt.toLocaleString("es-CL")} (${sameAmt.length}) ===`);
    for (const t of sameAmt.sort((a, z) => (a.date < z.date ? 1 : -1))) {
      console.log(`  ${t.date} | ${t.name} | cat:${t.category} | ws:${t.workspace} | ${t.importBatchId ? "importado" : "manual"} | id:${t.id.slice(0, 8)}`);
    }
  }

  const matchMov = movs.filter((m) => (m.description || "").toLowerCase().includes(term));
  console.log(`\n=== importedMovements con "${term}" (${matchMov.length}) ===`);
  for (const m of matchMov.sort((a, z) => (a.date < z.date ? 1 : -1))) {
    console.log(`  ${m.date} | $${Number(m.amount).toLocaleString("es-CL")} | ${m.description} | status:${m.status} | id:${m.id.slice(0, 10)}`);
  }
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
