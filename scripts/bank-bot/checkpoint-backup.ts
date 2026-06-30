/**
 * Checkpoint pre-Fase 6 — backup COMPLETO (read-only) de las colecciones que el relink va a tocar.
 * Escribe un único JSON con timestamp en scripts/bank-bot/. Es el salvavidas para restaurar datos.
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";

function le(fp: string) {
  if (!fs.existsSync(fp)) return;
  for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const s = t.indexOf("=");
    if (s === -1) continue;
    const k = t.slice(0, s).trim();
    const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
le(path.join(process.cwd(), ".env.local"));
le(path.join(process.cwd(), "client", ".env.local"));

const EXPECT = "my-cash-flow-bcb24";
if (process.env.VITE_FIREBASE_PROJECT_ID !== EXPECT) { console.error("ABORT projectId"); process.exit(1); }
const db = getFirestore(initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY!,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.VITE_FIREBASE_APP_ID!,
}));

const COLLECTIONS = [
  "accounts", "transactions", "importedMovements", "importBatches",
  "commitmentTemplates", "commitmentInstances", "movementRules",
  "creditCardStatements", "credit_card_settings",
];

(async () => {
  const NOW = new Date().toISOString();
  const dump: Record<string, any[]> = {};
  for (const c of COLLECTIONS) {
    const snap = await getDocs(collection(db, c));
    dump[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.log(`  ${c}: ${dump[c].length} docs`);
  }
  const fp = path.join(process.cwd(), "scripts", "bank-bot", `_checkpoint-pre-fase6-${NOW.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(fp, JSON.stringify({ ts: NOW, projectId: EXPECT, collections: dump }, null, 2));
  const total = Object.values(dump).reduce((s, a) => s + a.length, 0);
  console.log(`\n✓ Checkpoint: ${total} docs en ${COLLECTIONS.length} colecciones`);
  console.log(`  ${fp}`);
})();
