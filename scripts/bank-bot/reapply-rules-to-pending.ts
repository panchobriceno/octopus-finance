/**
 * Re-aplica las reglas actuales (v2 + manuales) a los movimientos PENDIENTES que ya estan en
 * la bandeja. SEGURO: solo cambia un movimiento si una regla LO MATCHEA; nunca resetea a
 * "Sin categoria" los que no matchean (a diferencia del viejo apply-rules.ts). Respeta la
 * direccion (no aplica regla de ingreso a un gasto). Util para categorizar el backlog tras
 * crear/editar reglas, sin esperar la proxima corrida.
 *
 * Correr:  npx tsx scripts/bank-bot/reapply-rules-to-pending.ts --dry
 *          npx tsx scripts/bank-bot/reapply-rules-to-pending.ts
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, writeBatch, type Firestore } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";
import type { ImportedMovement, MovementRule } from "../../shared/schema";
import { findBestMovementRule, applyMovementRule } from "../../client/src/domain/bank-imports";
import { rulesForDirection } from "./bot-helpers";

const DRY = process.argv.includes("--dry");
const NOW = new Date().toISOString();
const CHUNK = 400;
function loadEnv(fp: string) { if (!fs.existsSync(fp)) return; for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const s = t.indexOf("="); if (s === -1) continue; const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, ""); if (k && process.env[k] === undefined) process.env[k] = v; } }
function req(n: string) { const v = process.env[n]; if (!v) throw new Error(`Falta ${n}`); return v; }
loadEnv(path.join(process.cwd(), ".env.local")); loadEnv(path.join(process.cwd(), "client", ".env.local"));
const db = await getAuthedDb();

async function commitChunked(db: Firestore, ups: { id: string; patch: Record<string, unknown> }[]) {
  for (let off = 0; off < ups.length; off += CHUNK) {
    const b = writeBatch(db);
    for (const u of ups.slice(off, off + CHUNK)) b.update(doc(db, "importedMovements", u.id), u.patch);
    await b.commit();
  }
}

async function main() {
  const rules = (await getDocs(collection(db, "movementRules"))).docs.map((d) => ({ id: d.id, ...(d.data() as MovementRule) })).filter((r) => r.isActive !== false);
  const movs = (await getDocs(collection(db, "importedMovements"))).docs.map((d) => ({ id: d.id, ...(d.data() as ImportedMovement) })).filter((m) => m.status === "pending");

  const ups: { id: string; patch: Record<string, unknown> }[] = [];
  for (const m of movs) {
    const rule = findBestMovementRule(m as ImportedMovement, rulesForDirection(rules, m.direction));
    if (!rule) continue; // no matchea -> NO tocar (no resetear)
    const r = applyMovementRule(m as ImportedMovement, rule);
    if (r.suggestedCategory === m.suggestedCategory && r.suggestedWorkspace === m.suggestedWorkspace && r.matchedRuleId === m.matchedRuleId) continue; // sin cambios
    ups.push({ id: m.id, patch: { suggestedCategory: r.suggestedCategory, suggestedWorkspace: r.suggestedWorkspace, suggestedMovementType: r.suggestedMovementType, suggestedPaymentMethod: r.suggestedPaymentMethod, accountId: r.accountId ?? null, creditCardName: r.creditCardName ?? null, matchedRuleId: r.matchedRuleId, confidence: r.confidence, updatedAt: NOW } });
    console.log(`  ${m.date} $${Number(m.amount).toLocaleString("es-CL")} ${String(m.description).slice(0, 40)} -> ${r.suggestedCategory} / ${r.suggestedWorkspace} [conf ${r.confidence}]`);
  }
  console.log(`\n${DRY ? "[DRY] " : ""}Movimientos a actualizar por regla: ${ups.length} (de ${movs.length} pendientes)`);
  if (DRY) { console.log("(no se escribio nada)"); return; }
  await commitChunked(db, ups);
  console.log(`Actualizados ${ups.length}.`);
}
main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
