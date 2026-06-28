import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
import type { ImportBatch, ImportedMovement } from "../../shared/schema";

function loadEnvFile(fp: string) {
  if (!fs.existsSync(fp)) return;
  for (const line of fs.readFileSync(fp, "utf8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const s = t.indexOf("="); if (s === -1) continue;
    const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({
  apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID"),
}));

async function main() {
  console.log("Proyecto:", process.env.VITE_FIREBASE_PROJECT_ID);
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => d.data() as ImportedMovement);
  const batches = (await getDocs(collection(db, "importBatches"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportBatch) }));

  console.log(`\nimportedMovements total: ${movs.length}`);
  const byStatus: Record<string, number> = {};
  for (const m of movs) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
  console.log("  por status:", JSON.stringify(byStatus));

  console.log(`\nimportBatches total: ${batches.length}`);
  for (const b of batches.sort((a, z) => (a.createdAt < z.createdAt ? 1 : -1))) {
    const n = movs.filter((m) => m.batchId === b.id).length;
    console.log(`  [${b.status}] ${b.label} — rowCount=${b.rowCount}, movs reales=${n}, created=${b.createdAt}`);
  }
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
