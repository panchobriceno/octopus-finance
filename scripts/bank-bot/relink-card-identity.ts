/**
 * Fase 6 — Relink histórico de cardAccountId (octopus-finance).
 * Rellena SOLO cardAccountId (campo nuevo) en registros con tarjeta, resolviendo desde creditCardName.
 * NO toca accountId/creditCardName/bankName → dedupeKey/matchKey NO cambian (sin riesgo de duplicados).
 *
 * SEGURO: dry-run por defecto (--apply para escribir), guard projectId, backup + manifest, batch atómico.
 * Gating (Codex): solo donde la semántica es tarjeta. Flaggea (no toca) los casos raros.
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, writeBatch } from "firebase/firestore/lite";

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
const EXPECT = "my-cash-flow-bcb24";
if (process.env.VITE_FIREBASE_PROJECT_ID !== EXPECT) { console.error("ABORT projectId"); process.exit(1); }
const db = getFirestore(initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY!, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID!, storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!, appId: process.env.VITE_FIREBASE_APP_ID!,
}));
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const clp = (n: any) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
const digits = (s: any) => String(s ?? "").replace(/\D/g, "");
const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

type Acc = { id: string; name: string; bank: string; type: string; accountNumber?: string | null };

// resolveCardAccount inline (espejo de client/src/domain/account-identity.ts): cardAccountId → last4 único → nombre único; null si ambiguo.
function resolveCard(creditCardName: any, accounts: Acc[]): Acc | null {
  const cc = String(creditCardName ?? "");
  if (!cc) return null;
  const cards = accounts.filter((a) => a.type === "credit_card");
  const m = cc.match(/(\d{4})\s*$/);
  if (m) {
    const byL = cards.filter((a) => digits(a.accountNumber).slice(-4) === m[1] && digits(a.accountNumber).length >= 4);
    if (byL.length === 1) return byL[0];
    if (byL.length > 1) return null; // ambiguo
  }
  const byN = cards.filter((a) => norm(a.name) === norm(cc));
  return byN.length === 1 ? byN[0] : null;
}
const hasStructural = (cc: any) => /(\d{4})\s*$/.test(String(cc ?? ""));

type Stat = { wouldSet: number; alreadySame: number; existingDifferent: number; ambiguous: number; noSignal: number; flagged: number };
const newStat = (): Stat => ({ wouldSet: 0, alreadySame: 0, existingDifferent: 0, ambiguous: 0, noSignal: 0, flagged: 0 });

(async () => {
  const accounts = (await getDocs(collection(db, "accounts"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Acc[];
  console.log(APPLY ? "=== APLICANDO (solo cardAccountId, batch atómico) ===\n" : "=== DRY-RUN (--apply para escribir) ===\n");

  const batch = writeBatch(db);
  const manifest: any = { ts: NOW, writes: [] };
  const mapping = new Map<string, { acc: string; count: number; sum: number }>();
  const flags: string[] = [];
  let writes = 0;

  // (collection, isCardRecord(rec), label)
  const PLAN: { col: string; isCard: (r: any) => boolean; amountOf: (r: any) => number }[] = [
    { col: "transactions", isCard: (r) => r.movementType === "credit_card_payment" || (r.movementType === "expense" && r.paymentMethod === "credit_card"), amountOf: (r) => Number(r.amount) || 0 },
    { col: "importedMovements", isCard: (r) => r.sourceType === "credit_card", amountOf: (r) => Number(r.amount) || 0 },
    { col: "commitmentTemplates", isCard: (r) => r.paymentMethod === "credit_card" || r.movementType === "credit_card_payment", amountOf: (r) => Number(r.expectedAmount ?? r.amount) || 0 },
    { col: "commitmentInstances", isCard: (r) => r.paymentMethod === "credit_card" || r.movementType === "credit_card_payment", amountOf: (r) => Number(r.expectedAmount ?? r.amount) || 0 },
    { col: "movementRules", isCard: (r) => Boolean(r.creditCardName), amountOf: () => 0 },
  ];

  for (const p of PLAN) {
    const snap = await getDocs(collection(db, p.col));
    const st = newStat();
    for (const d of snap.docs) {
      const r = d.data() as any;
      const cc = r.creditCardName;
      // Flag: tiene creditCardName pero NO es semántica de tarjeta (ej. gasto con débito mal etiquetado)
      if (cc && !p.isCard(r)) { st.flagged++; flags.push(`${p.col}/${d.id}: creditCardName="${cc}" pero no es semántica tarjeta (mvType=${r.movementType} pay=${r.paymentMethod} src=${r.sourceType}) → NO se toca`); continue; }
      if (!p.isCard(r) || !cc) continue;
      const resolved = resolveCard(cc, accounts);
      if (!resolved) { if (hasStructural(cc)) st.ambiguous++; else st.noSignal++; continue; }
      if (r.cardAccountId === resolved.id) { st.alreadySame++; continue; }
      if (r.cardAccountId && r.cardAccountId !== resolved.id) { st.existingDifferent++; flags.push(`${p.col}/${d.id}: cardAccountId existente "${r.cardAccountId}" ≠ resuelto "${resolved.id}" (${resolved.name}) → NO se pisa`); continue; }
      // wouldSet
      st.wouldSet++; writes++;
      const key = `${cc} → ${resolved.name}`;
      const mp = mapping.get(key) ?? { acc: resolved.id, count: 0, sum: 0 };
      mp.count++; mp.sum += p.amountOf(r); mapping.set(key, mp);
      manifest.writes.push({ col: p.col, id: d.id, cardAccountId: resolved.id, was: r.cardAccountId ?? null, had: Object.prototype.hasOwnProperty.call(r, "cardAccountId") });
      if (APPLY) batch.update(doc(db, p.col, d.id), { cardAccountId: resolved.id });
    }
    console.log(`${p.col}: wouldSet=${st.wouldSet} · alreadySame=${st.alreadySame} · existingDifferent=${st.existingDifferent} · ambiguous=${st.ambiguous} · noSignal=${st.noSignal} · flagged=${st.flagged}`);
  }

  console.log("\n--- MAPEO creditCardName → cuenta (registros a setear) ---");
  for (const [k, v] of Array.from(mapping.entries()).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${v.count.toString().padStart(3)} reg · ${clp(v.sum).padStart(13)} · ${k}`);
  }

  if (flags.length) {
    console.log(`\n--- FLAGS (no se tocan, ${flags.length}) ---`);
    for (const f of flags.slice(0, 30)) console.log(`  ⚠ ${f}`);
    if (flags.length > 30) console.log(`  ... y ${flags.length - 30} más`);
  }

  console.log(`\nGARANTÍA: solo se escribe el campo cardAccountId. accountId/creditCardName/bankName NO se tocan → dedupeKey/matchKey cambian = 0.`);
  console.log(`--- TOTAL a setear: ${writes} ${APPLY ? "(APLICADOS en 1 batch)" : "(dry-run, nada escrito)"}`);

  if (APPLY && writes > 500) {
    console.error(`⛔ ABORT: ${writes} writes > 500 (límite de un writeBatch). Hay que implementar chunking antes de aplicar.`);
    process.exit(1);
  }
  if (APPLY) {
    const mp = path.join(process.cwd(), "scripts", "bank-bot", `_manifest-relink-${NOW.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(mp, JSON.stringify(manifest, null, 2));
    await batch.commit();
    console.log(`Manifest (para revertir): ${mp}`);
  }
})();
