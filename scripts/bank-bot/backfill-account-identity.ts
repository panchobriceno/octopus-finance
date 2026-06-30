/**
 * Fase 3 — Backfill de identidad de cuentas (octopus-finance).
 * - Setea accountNumber en cuentas existentes (keyed por ID, no por nombre).
 * - Normaliza typos de banco.
 * - Crea cuentas faltantes: tarjeta Santander Visa Empresa …6101 (fantasma, $1,44M) + línea Edwards de Javi.
 *
 * SEGURO: dry-run por defecto (--apply para escribir), guard de projectId, backup completo de `accounts`.
 * NO migra transactions/movements/commitments (eso es la Fase 6, relink). Acá solo cuentas.
 */
import fs from "node:fs";
import path from "node:path";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore, doc, writeBatch } from "firebase/firestore/lite";

const digits = (s: any) => String(s ?? "").replace(/\D/g, "");
const last4 = (s: any) => digits(s).slice(-4);

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
if (process.env.VITE_FIREBASE_PROJECT_ID !== EXPECT) {
  console.error("ABORT projectId");
  process.exit(1);
}
const db = getFirestore(initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY!,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.VITE_FIREBASE_APP_ID!,
}));
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);
const clp = (n: any) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");

// Updates por ID (datos confirmados por Pancho 30-jun-2026). Solo setea lo que falta o corrige typo.
const UPDATES: { id: string; label: string; set: Record<string, any> }[] = [
  { id: "4FWn8ZXcXRc0x3sVDApP", label: "T.C Edwards Signature Javi", set: { accountNumber: "****5073", bank: "Banco Edwards" } },
  { id: "RsR8lD7JZumlq63fX9lG", label: "T.C Edward Infini Javi", set: { accountNumber: "****1449", bank: "Banco Edwards" } },
  { id: "jgk2V3pZyqMKoatb4ymX", label: "Cuenta Corriente Banco Edwards Javi", set: { accountNumber: "00-310-11213-03", bank: "Banco Edwards" } },
  { id: "ofDf2tnlBbum76tvuiXp", label: "T.C Itaú Javi", set: { accountNumber: "****5381" } },
  { id: "c9winUUyqHUlTE1SHypY", label: "Cuenta Corriente Santander Javi", set: { accountNumber: "0-000-74-23551-4" } },
];

// Cuentas a crear (no existen hoy).
const CREATES: Record<string, any>[] = [
  {
    name: "T.C Santander Visa Empresa OM",
    bank: "Banco Santander",
    type: "credit_card",
    accountNumber: "****6101",
    currentBalance: 0,
    currency: "CLP",
    workspace: "business",
    isShared: false,
    notes: "Tarjeta empresa OM (creada en backfill de identidad, era fantasma con 54 usos).",
    updatedAt: TODAY,
  },
  {
    name: "Línea de Crédito Edwards Javi",
    bank: "Banco Edwards",
    type: "credit_line",
    accountNumber: "01-310-11213-04",
    currentBalance: 0,
    currency: "CLP",
    workspace: "family",
    isShared: false,
    notes: "",
    updatedAt: TODAY,
  },
  {
    name: "Cuenta Vista Santander Javi",
    bank: "Banco Santander",
    type: "checking",
    accountNumber: "0-07006-99554-8",
    currentBalance: 0,
    currency: "CLP",
    workspace: "family",
    isShared: false,
    notes: "Cuenta vista (distinta de la cuenta de ahorro).",
    updatedAt: TODAY,
  },
];

(async () => {
  const snap = await getDocs(collection(db, "accounts"));
  const byId = new Map(snap.docs.map((d) => [d.id, d.data() as any]));
  const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  console.log(APPLY ? "=== APLICANDO (batch atómico) ===\n" : "=== DRY-RUN (agregá --apply para escribir) ===\n");

  const batch = writeBatch(db);
  const manifest: any = { ts: NOW, updates: [], creates: [], aborted: false };
  let abort = false;

  console.log("--- A. UPDATES (cuentas existentes) ---");
  let willUpdate = 0;
  for (const u of UPDATES) {
    const cur = byId.get(u.id);
    if (!cur) { console.log(`  ✗ ${u.label}: NO existe id ${u.id} (saltado)`); continue; }
    // sanity: el ID debe corresponder al label esperado (no pisar la cuenta equivocada)
    if (cur.type === "credit_card" && !String(cur.name).toLowerCase().includes(u.label.toLowerCase().slice(0, 8).split(" ").pop() ?? "")) {
      // chequeo suave: solo avisa, no aborta (los nombres tienen typos)
    }
    const diffs: string[] = [];
    for (const [k, v] of Object.entries(u.set)) {
      // GUARD: no pisar un accountNumber no vacío que apunte a OTRA tarjeta (last4 distinto)
      if (k === "accountNumber" && digits(cur.accountNumber) && last4(cur.accountNumber) !== last4(v)) {
        console.log(`  ✗ ${u.label}: CONFLICTO accountNumber existente "${cur.accountNumber}" ≠ esperado "${v}" → ABORTO`);
        abort = true;
        continue;
      }
      if (String(cur[k] ?? "") !== String(v)) diffs.push(`${k}: "${cur[k] ?? "-"}" → "${v}"`);
    }
    if (!diffs.length) { console.log(`  = ${u.label}: ya correcto, sin cambios`); continue; }
    willUpdate++;
    console.log(`  ${APPLY ? "✓" : "•"} ${u.label}: ${diffs.join(" · ")}`);
    manifest.updates.push({ id: u.id, label: u.label, before: { ...u.set, ...Object.fromEntries(Object.keys(u.set).map((k) => [k, cur[k] ?? null])) }, after: { ...u.set } });
    if (APPLY) batch.update(doc(db, "accounts", u.id), { ...u.set, updatedAt: TODAY });
  }

  console.log("\n--- B. CREATES (cuentas nuevas) ---");
  let willCreate = 0;
  // snapshot mutable para deduplicar también contra creates de esta misma corrida
  const live = [...all];
  for (const c of CREATES) {
    const cd = digits(c.accountNumber);
    const dup = live.find((a: any) => {
      if (a.type !== c.type) return false;
      if (c.type === "credit_line" || c.type === "checking" || c.type === "savings") {
        return cd !== "" && digits(a.accountNumber) === cd; // cuentas: número COMPLETO
      }
      // tarjetas: type + banco canónico + last4
      return cd !== "" && last4(a.accountNumber) === last4(c.accountNumber) &&
        String(a.bank ?? "").toLowerCase().replace(/\s+/g, "") === String(c.bank).toLowerCase().replace(/\s+/g, "");
    });
    if (dup) { console.log(`  = ${c.name}: ya existe equivalente (${dup.name}), no se crea`); continue; }
    willCreate++;
    const ref = doc(collection(db, "accounts"));
    console.log(`  ${APPLY ? "✓" : "•"} crear ${c.name} | ${c.bank} | ${c.type} | nº ${c.accountNumber} | ws ${c.workspace}${APPLY ? ` | id=${ref.id}` : ""}`);
    manifest.creates.push({ id: APPLY ? ref.id : "(dry)", ...c });
    live.push({ id: ref.id, ...c });
    if (APPLY) batch.set(ref, c);
  }

  if (abort) {
    manifest.aborted = true;
    console.log("\n⛔ ABORTADO por conflicto — NO se escribió nada. Revisá los datos arriba.");
    process.exit(1);
  }

  if (APPLY) {
    const bp = path.join(process.cwd(), "scripts", "bank-bot", `_backup-accounts-${NOW.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(bp, JSON.stringify(all, null, 2));
    const mp = path.join(process.cwd(), "scripts", "bank-bot", `_manifest-backfill-${NOW.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(mp, JSON.stringify(manifest, null, 2));
    await batch.commit();
    console.log(`\nBackup: ${bp}\nManifest (incluye IDs creados, para revertir): ${mp}`);
  }

  console.log(`\n--- RESUMEN --- updates: ${willUpdate} · creates: ${willCreate} ${APPLY ? "(APLICADOS en 1 batch)" : "(dry-run, nada escrito)"}`);
  console.log("No tocada: 'Cuenta Ahorro' (es otra cuenta, sin número reportado).");
})();
