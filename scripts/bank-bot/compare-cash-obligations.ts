/**
 * Comparativo Plan 1 (read-only): "a pagar" ANTES (lógica actual del asesor) vs DESPUÉS
 * (buildCashObligations anti doble-conteo), con tu data real. NO escribe nada.
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";
import { buildCardDebt } from "@/domain/debt";
import { buildCashObligations } from "@/domain/cash-obligations";
import type { CommitmentInstance, Transaction, Account, CreditCardStatement } from "@shared/schema";

function le(fp: string) {
  if (!fs.existsSync(fp)) return;
  for (const l of fs.readFileSync(fp, "utf8").split(/\r?\n/)) {
    const t = l.trim(); if (!t || t.startsWith("#")) continue;
    const s = t.indexOf("="); if (s === -1) continue;
    const k = t.slice(0, s).trim(); const v = t.slice(s + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}
le(path.join(process.cwd(), ".env.local"));
le(path.join(process.cwd(), "client", ".env.local"));
const db = await getAuthedDb();
const clp = (n: any) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
const arr = async <T,>(c: string) => (await getDocs(collection(db, c))).docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as T[];
const daysBetween = (target: string, asOf: string) => Math.round((new Date(`${target}T00:00:00Z`).getTime() - new Date(`${asOf}T00:00:00Z`).getTime()) / 86400000);

(async () => {
  const asOf = new Date().toISOString().slice(0, 10);
  const [commitments, transactions, accounts, statements] = await Promise.all([
    arr<CommitmentInstance>("commitmentInstances"), arr<Transaction>("transactions"),
    arr<Account>("accounts"), arr<CreditCardStatement>("creditCardStatements"),
  ]);

  // ANTES: lógica actual del asesor (todos los compromisos pendientes en ventana -7..45).
  const before = commitments
    .filter((c) => c.status === "pending" && c.dueDate)
    .map((c) => ({ name: c.name, amount: Number(c.expectedAmount) || 0, d: daysBetween(c.dueDate, asOf) }))
    .filter((o) => o.d >= -7 && o.d <= 45 && o.amount > 0);
  const beforeTotal = before.reduce((s, o) => s + o.amount, 0);

  // DESPUÉS: buildCashObligations (real).
  const cardDebts = buildCardDebt(statements, transactions, accounts, { asOf });
  const after = buildCashObligations({ commitments, cardDebts, cardAccounts: accounts.filter((a) => a.type === "credit_card"), asOf });

  console.log(`=== COMPARATIVO PLAN 1 (asOf ${asOf}, ventana 45 días) ===\n`);
  console.log(`ANTES (asesor actual): ${clp(beforeTotal)}  ·  ${before.length} obligaciones`);
  console.log(`DESPUÉS (sin doble-conteo): ${clp(after.totals.total)}  ·  ${after.obligations.length} obligaciones`);
  console.log(`   ├─ caja (banco): ${clp(after.totals.cash)}`);
  console.log(`   └─ pago de tarjetas (real): ${clp(after.totals.card)}`);
  console.log(`DELTA: ${clp(after.totals.total - beforeTotal)}\n`);

  console.log(`--- EXCLUIDO (estaba doble-contado) ---`);
  console.log(`  Suscripciones de tarjeta: ${after.excluded.cardCommitments.count} · ${clp(after.excluded.cardCommitments.sum)} (ahora dentro del pago de tarjeta)`);
  console.log(`  Placeholders fijos T.C: ${after.excluded.placeholders.count} · ${clp(after.excluded.placeholders.sum)} (reemplazados por deuda real)\n`);

  console.log(`--- PAGOS DE TARJETA AGREGADOS (deuda real de cartola) ---`);
  for (const o of after.obligations.filter((x) => x.kind === "card_payment")) {
    const usd = o.meta?.deudaUsd ? ` + US$${o.meta.deudaUsd}` : "";
    console.log(`  ${o.label}: ${clp(o.amount)}${usd}  (facturado ${clp(o.meta?.facturado)} − pagado ${clp(o.meta?.pagado)}) · vence ${o.dueDate}${o.meta?.vencido ? " ⚠VENCIDA" : ""}`);
  }
  if (after.warnings.length) { console.log(`\n--- AVISOS ---`); for (const w of after.warnings) console.log(`  ⚠ ${w}`); }

  console.log(`\n--- OBLIGACIONES DE CAJA (banco) resultantes ---`);
  for (const o of after.obligations.filter((x) => x.kind === "commitment")) console.log(`  ${o.label.padEnd(28)} ${clp(o.amount).padStart(12)} · vence ${o.dueDate}`);
})();
