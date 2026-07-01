/**
 * Limpieza DATOS (octopus-finance) — confirmada 1:1 con Pancho (2026-06-30).
 * A) 15 movimientos sin cuenta/tarjeta → asigna cuenta/tarjeta/tipo correcto.
 * B) Categoría "Transferencia" → "Transferencias" (match catálogo).
 * C) Consulta Javi: 3 templates + sus instancias → workspace "dentist".
 *
 * SEGURO: dry-run por defecto (--apply para escribir), guard projectId, backup FULL + manifest,
 * batch atómico, escribe por getAuthedDb() (rules cerradas). NO re-correr tras aplicar.
 */
import fs from "node:fs";
import path from "node:path";
import { collection, getDocs, doc, writeBatch } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";

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
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const clp = (n: any) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");

// Cuentas (ids fijos, verificados contra la base):
const A = {
  ccEdwardsPancho: "2Bx9eSqmlGJaBLw5RBTy",
  ccEdwardsJavi: "jgk2V3pZyqMKoatb4ymX",
  ccOM: "asIrUoWJkN1jH2zzJhT0",
  lineaOM: "zRaXNnOJXOQEdwe2sfoe",
  lineaEdwardsPancho: "HhY4mCYg7FLv3tNN8kiy",
  tc7232: "PkkkaDXs7JzFXqgfeosS",
  tc6101: "kXA5EfmXyUdJfhNo3TQX",
};

// A + B) updates de transactions: id -> campos a setear + por qué
const TX: { id: string; set: Record<string, any>; why: string }[] = [
  { id: "9mPPdf22ldwokwT4iVcs", set: { accountId: A.ccEdwardsPancho }, why: "#1 pagó CC-Edwards-Pancho" },
  { id: "OCCOXO2uAqs5iVOwmzpa", set: { accountId: A.ccEdwardsJavi }, why: "#2 pagó CC-Edwards-Javi" },
  { id: "INoRDdUdwA2uFeYFKrX2", set: { cardAccountId: A.tc6101 }, why: "#3 tarjeta TC-6101" },
  { id: "nq62HBeuCNo4VCVhSIQ0", set: { accountId: A.ccOM }, why: "#4 entró a CC-OM" },
  { id: "qG5xBoXgYar0WRr08k2j", set: { accountId: A.ccOM }, why: "#5 entró a CC-OM" },
  { id: "3IVsjYajiebY8qDNq1hG", set: { accountId: A.ccOM }, why: "#6 salió de CC-OM" },
  { id: "v1V5S7vyRHAN1p5vM0do", set: { destinationAccountId: A.lineaOM }, why: "#7 destino Línea-OM" },
  { id: "ZMqKp3hzE7PVeGfda5Ne", set: { accountId: A.ccEdwardsPancho }, why: "#8 salió de CC-Edwards-Pancho" },
  { id: "q49C9MSTqYNRBlD2ai9E", set: { accountId: A.ccEdwardsPancho }, why: "#9 pagó CC-Edwards-Pancho" },
  { id: "iv6iLPxP9O1IR8GDw9pS", set: { paymentMethod: "credit_card", cardAccountId: A.tc7232 }, why: "#10 compra con TC-7232" },
  { id: "Dr7geSouf38hc9RIrzS8", set: { paymentMethod: "bank_account", accountId: A.ccEdwardsPancho, cardAccountId: null }, why: "#11 débito CC-Edwards-Pancho" },
  { id: "GSmZkRRmFD6W7FTyuHvO", set: { accountId: A.ccOM }, why: "#12 CC-OM" },
  { id: "k7nQJYfDcXFvoTcWmojW", set: { accountId: A.lineaOM, destinationAccountId: A.ccOM }, why: "#13 Línea-OM → CC-OM" },
  { id: "uiUTStx6UUleYCvrMk1c", set: { paymentMethod: "bank_account", accountId: A.ccOM, cardAccountId: null }, why: "#14 débito CC-OM" },
  { id: "EtcnFIhqvSsKPh0x8XzK", set: { accountId: A.lineaEdwardsPancho, destinationAccountId: A.ccEdwardsPancho }, why: "#15 Línea-Edwards-Pancho → CC-Edwards-Pancho" },
  { id: "AyMWXOD2NJiNfhntpkCe", set: { category: "Transferencias" }, why: "B) categoría Transferencia→Transferencias" },
];

// C) Consulta Javi: templates → dentist (sus instancias se resuelven por templateId)
const CJ_TEMPLATES = ["3imZ7qkSplmMtlh0Y0CY", "BijmfuiMFPf77Ep0PjXy", "euH2pbMb0Qp139FS7Sjw"];

(async () => {
  const db = await getAuthedDb();
  console.log(APPLY ? "=== APLICANDO (batch atómico) ===\n" : "=== DRY-RUN (--apply para escribir) ===\n");

  const txDocs = new Map((await getDocs(collection(db, "transactions"))).docs.map((d) => [d.id, d.data() as any]));
  const tplDocs = new Map((await getDocs(collection(db, "commitmentTemplates"))).docs.map((d) => [d.id, d.data() as any]));
  const instSnap = (await getDocs(collection(db, "commitmentInstances"))).docs;

  const batch = writeBatch(db);
  const manifest: any = { ts: NOW, backups: [] };
  let writes = 0;
  const line = (col: string, id: string, set: Record<string, any>, before: any, why: string) => {
    const diff = Object.keys(set).map((k) => `${k}: ${JSON.stringify(before?.[k] ?? null)} → ${JSON.stringify(set[k])}`).join(", ");
    console.log(`  ${col}/${id}  [${why}]\n      ${diff}`);
    manifest.backups.push({ col, id, set, before }); // before = doc COMPLETO para restaurar
    if (APPLY) batch.update(doc(db, col, id), set);
    writes++;
  };

  console.log("--- A+B) TRANSACCIONES ---");
  for (const u of TX) {
    const before = txDocs.get(u.id);
    if (!before) { console.log(`  ⚠ transactions/${u.id} NO EXISTE — omitido (${u.why})`); continue; }
    console.log(`  (${clp(before.amount)}  "${before.name}")`);
    line("transactions", u.id, u.set, before, u.why);
  }

  console.log("\n--- C) CONSULTA JAVI → dentist ---");
  for (const tid of CJ_TEMPLATES) {
    const before = tplDocs.get(tid);
    if (!before) { console.log(`  ⚠ commitmentTemplates/${tid} NO EXISTE`); continue; }
    if (before.workspace === "dentist") { console.log(`  = template ${tid} ya está en dentist`); }
    else line("commitmentTemplates", tid, { workspace: "dentist" }, before, `template "${before.name}"`);
  }
  for (const d of instSnap) {
    const r = d.data() as any;
    if (!CJ_TEMPLATES.includes(r.templateId)) continue;
    if (r.workspace === "dentist") { console.log(`  = instancia ${d.id} ya está en dentist`); continue; }
    line("commitmentInstances", d.id, { workspace: "dentist" }, r, `instancia ${r.monthKey ?? ""} "${r.name}"`);
  }

  console.log(`\n--- TOTAL: ${writes} escrituras ${APPLY ? "(APLICADAS en 1 batch)" : "(dry-run, nada escrito)"}`);
  if (APPLY && writes > 500) { console.error("⛔ ABORT: >500 writes (límite batch)"); process.exit(1); }
  if (APPLY) {
    const mp = path.join(process.cwd(), "scripts", "bank-bot", `_manifest-datos-${NOW.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(mp, JSON.stringify(manifest, null, 2));
    await batch.commit();
    console.log(`✅ Aplicado. Backup+manifest (para revertir): ${mp}`);
  }
})();
