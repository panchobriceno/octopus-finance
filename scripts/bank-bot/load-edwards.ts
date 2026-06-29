/**
 * Etapa 2 — Cargar movimientos de Edwards a la bandeja de importacion de la app.
 *
 * Escribe ImportBatch + ImportedMovement en Firestore (igual que la importacion de la app),
 * en estado "pending" para que Pancho los revise/convierta. NO auto-convierte.
 *
 * Idempotente: usa id de documento DETERMINISTICO derivado del dedupeKey, y ademas
 * saltea los movimientos cuyo dedupeKey ya existe. Re-correr no duplica ni crea lotes vacios.
 *
 * Correr:  npx tsx scripts/bank-bot/load-edwards.ts
 *          npx tsx scripts/bank-bot/load-edwards.ts --dry   (no escribe, solo muestra)
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  where,
  writeBatch,
} from "firebase/firestore/lite";
import type { ImportBatch, ImportedMovement } from "../../shared/schema";
import { buildImportedMovement } from "../../client/src/domain/bank-imports";
import { buildEdwardsSeeds, type SeedNoBatch } from "./parse-edwards";

const DRY = process.argv.includes("--dry");

// ----------------------------- env + firestore -----------------------------

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim();
    const value = trimmed.slice(sep + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en .env.local`);
  return value;
}

function createDb() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env.local"));
  loadEnvFile(path.join(root, "client", ".env.local"));
  const app = initializeApp({
    apiKey: requiredEnv("VITE_FIREBASE_API_KEY"),
    authDomain: requiredEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: requiredEnv("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: requiredEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requiredEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: requiredEnv("VITE_FIREBASE_APP_ID"),
  });
  return getFirestore(app);
}

function deterministicId(dedupeKey: string) {
  return "edw_" + createHash("sha1").update(dedupeKey).digest("hex").slice(0, 20);
}

// ----------------------------- carga de un grupo -----------------------------

type LoadResult = { source: string; created: number; skipped: number; total: number };

async function loadGroup(
  db: ReturnType<typeof getFirestore>,
  seeds: SeedNoBatch[],
  meta: { label: string; sourceName: string; sourceType: string; bankName: string | null; creditCardName: string | null },
): Promise<LoadResult> {
  if (seeds.length === 0) return { source: meta.label, created: 0, skipped: 0, total: 0 };

  const batchRef = doc(collection(db, "importBatches"));
  const batchId = batchRef.id;
  const now = new Date().toISOString();

  // construir movimientos
  const movements = seeds.map((seed) => {
    const m = buildImportedMovement({ ...seed, batchId });
    return { id: deterministicId(m.dedupeKey), data: m };
  });

  const dates = movements.map((m) => m.data.date).sort();
  const start = dates[0];
  const end = dates[dates.length - 1];

  // que ya existe en ese rango (para saltear)
  const existingSnap = await getDocs(
    query(collection(db, "importedMovements"), where("date", ">=", start), where("date", "<=", end)),
  );
  const existingKeys = new Set<string>();
  existingSnap.forEach((d) => {
    const data = d.data() as ImportedMovement;
    if (data.status !== "discarded") existingKeys.add(data.dedupeKey);
  });

  const fresh = movements.filter((m) => !existingKeys.has(m.data.dedupeKey));
  const skipped = movements.length - fresh.length;

  if (fresh.length === 0) return { source: meta.label, created: 0, skipped, total: movements.length };

  const totalIncome = fresh.filter((m) => m.data.direction === "income").reduce((s, m) => s + m.data.amount, 0);
  const totalExpense = fresh.filter((m) => m.data.direction === "expense").reduce((s, m) => s + m.data.amount, 0);

  const batchPayload: Omit<ImportBatch, "id"> = {
    label: meta.label,
    source: "browser_assistant",
    sourceName: meta.sourceName,
    sourceType: meta.sourceType,
    bankName: meta.bankName,
    accountId: null,
    creditCardName: meta.creditCardName,
    workspace: "business",
    periodStart: start,
    periodEnd: end,
    rowCount: fresh.length,
    totalIncome,
    totalExpense,
    duplicateCount: 0,
    status: "reviewing",
    isDemo: false,
    notes: "Cargado por bank-bot (Edwards)",
    createdAt: now,
    updatedAt: now,
  };

  if (DRY) {
    console.log(`  [DRY] ${meta.label}: crearia lote ${batchId} con ${fresh.length} nuevos (saltea ${skipped})`);
    return { source: meta.label, created: fresh.length, skipped, total: movements.length };
  }

  const batch = writeBatch(db);
  batch.set(batchRef, batchPayload);
  for (const m of fresh) {
    batch.set(doc(db, "importedMovements", m.id), m.data);
  }
  await batch.commit();

  return { source: meta.label, created: fresh.length, skipped, total: movements.length };
}

// ----------------------------- main -----------------------------

async function main() {
  const { checking, card, skipped, issues } = buildEdwardsSeeds();
  if (issues.length) {
    console.log("Filas con problemas (no se cargan):");
    issues.forEach((i) => console.log(`  ⚠ ${i}`));
  }

  const db = createDb();
  console.log(`\n${DRY ? "[DRY-RUN] " : ""}Cargando a Firestore (proyecto ${process.env.VITE_FIREBASE_PROJECT_ID})...\n`);

  const results: LoadResult[] = [];
  results.push(
    await loadGroup(db, checking, {
      label: `Edwards Cuenta Corriente — ${new Date().toLocaleDateString("es-CL")}`,
      sourceName: "Edwards Cuenta Corriente 00-310-10777-06",
      sourceType: "bank_account",
      bankName: "Banco Edwards",
      creditCardName: null,
    }),
  );
  results.push(
    await loadGroup(db, card, {
      label: `Edwards Tarjeta ****7232 — ${new Date().toLocaleDateString("es-CL")}`,
      sourceName: "Edwards Tarjeta ****7232",
      sourceType: "credit_card",
      bankName: "Banco Edwards",
      creditCardName: "Edwards Visa ****7232",
    }),
  );

  console.log("--- Resultado ---");
  for (const r of results) {
    console.log(`  ${r.source}: ${r.created} cargados, ${r.skipped} ya existian (de ${r.total})`);
  }
  console.log(`  Omitidos a proposito (pagos de tarjeta): ${skipped.length}`);
  console.log("\nListo. Revisalos en la app → Movimientos Bancarios.\n");
}

main().catch((err) => {
  console.error("ERROR:", err?.message ?? err);
  process.exit(1);
});
