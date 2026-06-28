/**
 * Revertir la carga del bank-bot: borra los importBatches creados por el bot
 * (notes == "Cargado por bank-bot (Edwards)") y todos sus importedMovements.
 *
 * Correr:  npx tsx scripts/bank-bot/rollback-edwards.ts --dry   (muestra que borraria)
 *          npx tsx scripts/bank-bot/rollback-edwards.ts         (borra de verdad)
 */

import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  query,
  where,
} from "firebase/firestore/lite";
import type { ImportBatch, ImportedMovement } from "../../shared/schema";

const DRY = process.argv.includes("--dry");
const BOT_NOTE = "Cargado por bank-bot (Edwards)";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const sep = t.indexOf("=");
    if (sep === -1) continue;
    const key = t.slice(0, sep).trim();
    const value = t.slice(sep + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
function reqEnv(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }

function createDb() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env.local"));
  loadEnvFile(path.join(root, "client", ".env.local"));
  const app = initializeApp({
    apiKey: reqEnv("VITE_FIREBASE_API_KEY"),
    authDomain: reqEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: reqEnv("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: reqEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: reqEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: reqEnv("VITE_FIREBASE_APP_ID"),
  });
  return getFirestore(app);
}

async function main() {
  const db = createDb();
  console.log(`${DRY ? "[DRY] " : ""}Buscando lotes del bot en ${process.env.VITE_FIREBASE_PROJECT_ID}...`);

  const batchesSnap = await getDocs(collection(db, "importBatches"));
  const botBatches = batchesSnap.docs.filter((d) => (d.data() as ImportBatch).notes === BOT_NOTE);
  console.log(`Lotes del bot encontrados: ${botBatches.length}`);

  let deletedMovs = 0;
  for (const b of botBatches) {
    const movsSnap = await getDocs(query(collection(db, "importedMovements"), where("batchId", "==", b.id)));
    console.log(`  Lote ${b.id} (${(b.data() as ImportBatch).label}): ${movsSnap.size} movimientos`);
    if (!DRY) {
      for (const m of movsSnap.docs) {
        await deleteDoc(doc(db, "importedMovements", m.id));
        deletedMovs++;
      }
      await deleteDoc(doc(db, "importBatches", b.id));
    } else {
      deletedMovs += movsSnap.size;
    }
  }

  console.log(`\n${DRY ? "[DRY] Borraria" : "Borrados"}: ${botBatches.length} lotes + ${deletedMovs} movimientos.`);
  if (DRY) console.log("(no se borro nada — saca --dry para ejecutar)");
}

main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
