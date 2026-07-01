/**
 * Borra los cobros semilla de junio (recurring-seed-*-2026-06), que tenían expectedDate mal puesto
 * en julio → duplicaban el ingreso de julio ($8.26M → $4.13M). Decisión de Pancho (2026-07-01):
 * "junio ya se gastó, empezar limpios en julio".
 * SEGURO: dry-run por defecto (--apply), guard projectId, backup FULL + manifest, getAuthedDb, borrado acotado.
 */
import fs from "node:fs";
import path from "node:path";
import { collection, getDocs, doc, deleteDoc } from "firebase/firestore/lite";
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

(async () => {
  const db = await getAuthedDb();
  const all = (await getDocs(collection(db, "clientPayments"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  // Acotado: solo semillas recurrentes de junio, projected (no tocar nada pagado/real).
  const target = all.filter((p: any) =>
    p.id.startsWith("recurring-seed-") && p.id.endsWith("-2026-06") && p.status === "projected",
  );
  console.log(APPLY ? "=== APLICANDO borrado ===\n" : "=== DRY-RUN (--apply para borrar) ===\n");
  const manifest: any = { ts: NOW, deleted: [] };
  let sum = 0;
  for (const p of target as any[]) {
    console.log(`  BORRAR clientPayments/${p.id}  "${p.clientName}"  net ${clp(p.netAmount)}  expected=${p.expectedDate}  status=${p.status}`);
    manifest.deleted.push(p); // doc COMPLETO para restaurar
    sum += Number(p.netAmount) || 0;
    if (APPLY) await deleteDoc(doc(db, "clientPayments", p.id));
  }
  console.log(`\n  Total a borrar: ${target.length} cobros · ${clp(sum)} · quedan ${all.length - target.length} clientPayments`);
  if (APPLY) {
    const mp = path.join(process.cwd(), "scripts", "bank-bot", `_manifest-del-june-${NOW.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(mp, JSON.stringify(manifest, null, 2));
    console.log(`✅ Borrado. Backup+manifest (para restaurar): ${mp}`);
  }
})();
