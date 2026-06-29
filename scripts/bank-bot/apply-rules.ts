/**
 * Aplica las MovementRules (las 18 generadas) a los movimientos pendientes del bot,
 * usando las funciones reales de la app (findBestMovementRule/applyMovementRule).
 * Estable y no-circular (las reglas son la fuente curada). Es lo que usara el bot diario.
 *
 * Correr:  npx tsx scripts/bank-bot/apply-rules.ts --dry   (muestra)
 *          npx tsx scripts/bank-bot/apply-rules.ts         (actualiza)
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, updateDoc } from "firebase/firestore/lite";
import type { ImportedMovement, ImportBatch, MovementRule } from "../../shared/schema";
import { findBestMovementRule, applyMovementRule } from "../../client/src/domain/bank-imports";

const DRY = process.argv.includes("--dry");
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = getFirestore(initializeApp({ apiKey: req("VITE_FIREBASE_API_KEY"), authDomain: req("VITE_FIREBASE_AUTH_DOMAIN"), projectId: req("VITE_FIREBASE_PROJECT_ID"), storageBucket: req("VITE_FIREBASE_STORAGE_BUCKET"), messagingSenderId: req("VITE_FIREBASE_MESSAGING_SENDER_ID"), appId: req("VITE_FIREBASE_APP_ID") }));

async function main() {
  const rules = (await getDocs(collection(db, "movementRules"))).docs.map((d) => ({ id: d.id, ...(d.data() as MovementRule) }));
  const batches = (await getDocs(collection(db, "importBatches"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportBatch) }));
  const myBatchIds = new Set(batches.filter((b) => (b.notes || "").includes("bank-bot")).map((b) => b.id));
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) }))
    .filter((m) => myBatchIds.has(m.batchId) && m.status === "pending");

  let n = 0;
  for (const m of movs) {
    const rule = findBestMovementRule(m, rules);
    if (rule) {
      const updated = applyMovementRule(m, rule);
      n++;
      console.log(`  ✓ ${m.description.slice(0, 40).padEnd(40)} -> ${updated.suggestedCategory} / ${updated.suggestedWorkspace}  [regla: ${rule.keywords.join(",")}]`);
      if (!DRY) {
        await updateDoc(doc(db, "importedMovements", m.id), {
          suggestedCategory: updated.suggestedCategory,
          suggestedWorkspace: updated.suggestedWorkspace,
          suggestedMovementType: updated.suggestedMovementType,
          matchedRuleId: updated.matchedRuleId,
        });
      }
    } else if (m.suggestedCategory !== "Sin categoría") {
      // limpiar matches ruidosos previos -> volver a Sin categoria
      if (!DRY) await updateDoc(doc(db, "importedMovements", m.id), { suggestedCategory: "Sin categoría", matchedRuleId: null });
      console.log(`  · ${m.description.slice(0, 40).padEnd(40)} -> Sin categoría (reset)`);
    }
  }
  console.log(`\n${DRY ? "[DRY] " : ""}Pendientes: ${movs.length} | por regla: ${n} | resto: Sin categoría`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
