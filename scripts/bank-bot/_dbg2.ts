import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
import type { Transaction } from "../../shared/schema";
import { buildImportedMovement } from "../../client/src/domain/bank-imports";
import { parseSantanderPayment } from "./parse-email";

function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: process.env.VITE_FIREBASE_API_KEY!, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!, projectId: process.env.VITE_FIREBASE_PROJECT_ID!, storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET!, messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!, appId: process.env.VITE_FIREBASE_APP_ID! }));

(async () => {
  const txs = (await getDocs(collection(db, "transactions"))).docs.map((d) => d.data() as Transaction);
  const types = new Set(txs.map((t) => String(t.type)));
  console.log("Valores distintos de Transaction.type:", [...types]);
  // El SII $527.392
  const sii = txs.filter((t) => Number(t.amount) === 527392);
  console.log("\nTransacciones con monto 527392:");
  for (const t of sii) console.log(`  type=${JSON.stringify(t.type)} date=${t.date} desc=${(t as any).description ?? (t as any).name}`);
  // Qué movementType produce el seed
  const seed = parseSantanderPayment("El pago se ha realizado con éxito Monto:$527.392 Servicio: Pago a S.I.I. Fecha: 21-06-2026");
  const m = buildImportedMovement({ ...seed!, batchId: "x" });
  console.log("\nMovimiento construido: movementType=", JSON.stringify(m.movementType), " amount=", m.amount);
})();
