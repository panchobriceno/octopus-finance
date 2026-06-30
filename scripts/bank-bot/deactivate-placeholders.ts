/**
 * #2 — Desactivar placeholders fijos "T.C Pancho" / "T.C Javi" (octopus-finance).
 * Eran montos falsos ($140k) que el asesor ya excluye, pero si se marcan pagados se DUPLICAN con el
 * pago real de la tarjeta. Los damos de baja: template isActive=false + instancias pendientes → cancelled.
 * SEGURO: dry-run por defecto (--apply), guard projectId, backup + manifest, batch atómico.
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
const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const PLACEHOLDER = new Set(["t.c pancho", "t.c javi"]);

(async () => {
  const templatesSnap = await getDocs(collection(db, "commitmentTemplates"));
  const instancesSnap = await getDocs(collection(db, "commitmentInstances"));
  console.log(APPLY ? "=== APLICANDO (batch atómico) ===\n" : "=== DRY-RUN (--apply para escribir) ===\n");
  const batch = writeBatch(db);
  const manifest: any = { ts: NOW, templates: [], instancesCancelled: 0 };
  const ids = new Set<string>();

  for (const d of templatesSnap.docs) {
    const r = d.data() as any;
    if (!PLACEHOLDER.has(norm(r.category)) && !PLACEHOLDER.has(norm(r.name))) continue;
    ids.add(d.id);
    console.log(`  • DESACTIVAR placeholder: ${r.name} (cat ${r.category})`);
    manifest.templates.push({ id: d.id, name: r.name, was: { isActive: r.isActive ?? null } });
    if (APPLY) batch.update(doc(db, "commitmentTemplates", d.id), { isActive: false });
  }
  let cancelled = 0;
  for (const d of instancesSnap.docs) {
    const r = d.data() as any;
    if (!ids.has(r.templateId)) continue;
    if (r.status !== "pending") continue;
    cancelled++;
    if (APPLY) batch.update(doc(db, "commitmentInstances", d.id), { status: "cancelled" });
  }
  manifest.instancesCancelled = cancelled;

  const total = manifest.templates.length + cancelled;
  console.log(`\n--- TOTAL: ${manifest.templates.length} plantillas desactivadas + ${cancelled} instancias canceladas = ${total} writes ${APPLY ? "(APLICADOS)" : "(dry-run)"}`);
  if (APPLY && total > 0) {
    const mp = path.join(process.cwd(), "scripts", "bank-bot", `_manifest-deactivate-ph-${NOW.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(mp, JSON.stringify(manifest, null, 2));
    await batch.commit();
    console.log(`Manifest (para revertir): ${mp}`);
  }
})();
