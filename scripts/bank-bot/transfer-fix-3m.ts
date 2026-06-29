/**
 * Arregla el traspaso de $3.000.000 (16-jun, Santander OM -> Edwards cuenta corriente):
 *  1. DESCARTA el movimiento pendiente de INGRESO "de Agencia Octopus" (es el otro lado del
 *     mismo traspaso, ya registrado; convertirlo sumaria $3M de ingreso falso).
 *  2. Convierte la transaccion existente ($3M gasto "Transf a Francisco Briceno") en un
 *     TRASPASO de verdad: movementType="transfer", cuenta origen OM, cuenta destino Edwards.
 *     finance.ts excluye los transfer del P&L -> deja de contar como gasto.
 *  3. Crea la categoria "Transferencias" (gasto, business) si no existe.
 *
 * Forma del traspaso validada por Codex. assertCompleteTransfer exige destino + origen != destino.
 *
 * Correr:  npx tsx scripts/bank-bot/transfer-fix-3m.ts --dry
 *          npx tsx scripts/bank-bot/transfer-fix-3m.ts
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { addDoc, collection, doc, getDocs, getFirestore, updateDoc } from "firebase/firestore/lite";
import type { Category, ImportedMovement, Transaction } from "../../shared/schema";

const DRY = process.argv.includes("--dry");
const NOW = new Date().toISOString();
const OM = "asIrUoWJkN1jH2zzJhT0";          // Santander Cuenta Corriente OM (origen)
const EDWARDS = "2Bx9eSqmlGJaBLw5RBTy";      // Edwards Cuenta Corriente Pancho (destino)
const AMOUNT = 3000000;
const DATE = "2026-06-16";
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

async function main() {
  // 1) movimiento ingreso pendiente a descartar
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }));
  const incomeDup = movs.filter((m) => Number(m.amount) === AMOUNT && m.date === DATE && m.status === "pending" && m.direction === "income");
  // 2) transaccion gasto $3M a convertir en traspaso
  const txsSnap = await getDocs(collection(db, "transactions"));
  const txs = txsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Transaction) }));
  const expenseTx = txs.filter((t) => Number(t.amount) === AMOUNT && t.date === DATE && t.type === "expense");
  // 3) categoria Transferencias
  const cats = (await getDocs(collection(db, "categories"))).docs.map((d) => d.data() as Category);
  const hasTransferCat = cats.some((c) => norm(c.name) === "transferencias" && c.type === "expense" && (c.workspace ?? "") === "business");

  console.log("== Plan ==");
  console.log(`Descartar movimiento(s) ingreso $3M pendiente: ${incomeDup.length}`);
  for (const m of incomeDup) console.log(`  - [${m.status}] ${m.date} ${m.direction} ${String(m.description).slice(0, 45)} (id ${m.id})`);
  console.log(`Convertir a traspaso transaccion(es) gasto $3M: ${expenseTx.length}`);
  for (const t of expenseTx) console.log(`  ~ ${t.date} ${t.type} "${String((t as any).name).slice(0, 45)}" ws=${t.workspace} -> movementType=transfer, acct=OM, dest=Edwards`);
  console.log(`Crear categoria "Transferencias" (expense/business): ${hasTransferCat ? "ya existe" : "si"}`);

  if (incomeDup.length !== 1 || expenseTx.length !== 1) {
    console.log("\n[ABORTA] esperaba exactamente 1 movimiento ingreso y 1 transaccion gasto. Revisar a mano.");
    return;
  }
  if (DRY) { console.log("\n[DRY] no se escribio nada."); return; }

  if (!hasTransferCat) await addDoc(collection(db, "categories"), { name: "Transferencias", type: "expense", workspace: "business", color: "#64748b" });
  await updateDoc(doc(db, "importedMovements", incomeDup[0].id), { status: "discarded", notes: "Descartado: otro lado del traspaso ya registrado", updatedAt: NOW });
  await updateDoc(doc(db, "transactions", expenseTx[0].id), {
    movementType: "transfer",
    category: "Transferencias",
    workspace: "business",
    accountId: OM,
    destinationWorkspace: "family",
    destinationAccountId: EDWARDS,
    updatedAt: NOW,
  });
  console.log("\nListo: ingreso descartado + gasto convertido en traspaso OM->Edwards (fuera del P&L).");
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
