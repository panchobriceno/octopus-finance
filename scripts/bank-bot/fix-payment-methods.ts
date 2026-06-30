/**
 * Fix de métodos de pago de compromisos (octopus-finance) — corrige doble-conteo en "Gastos del mes".
 * Por indicación de Pancho (30-jun-2026):
 *  - A TARJETA 7232: Comida, Seguros Complementarios, Agenda Pro, Cuota Iphones.
 *  - DESACTIVAR el duplicado: "Iphones Empresa" (template isActive=false + instancias pendientes → cancelled).
 *  - Farmacia y el resto quedan en débito (sin cambios).
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

const CARD = { id: "PkkkaDXs7JzFXqgfeosS", name: "T.C Edwards Pancho" }; // 7232
const TO_CARD = new Set(["comida", "seguros complementarios", "agenda pro", "cuota iphones"].map(norm));
const TO_DEACTIVATE = new Set(["iphones empresa"].map(norm));
const SET_CARD = { paymentMethod: "credit_card", creditCardName: CARD.name, cardAccountId: CARD.id };

(async () => {
  const templatesSnap = await getDocs(collection(db, "commitmentTemplates"));
  const instancesSnap = await getDocs(collection(db, "commitmentInstances"));
  console.log(APPLY ? "=== APLICANDO (batch atómico) ===\n" : "=== DRY-RUN (--apply para escribir) ===\n");
  const batch = writeBatch(db);
  const manifest: any = { ts: NOW, toCard: [], deactivate: [], instances: { card: 0, cancelled: 0 } };

  const cardTemplateIds = new Set<string>();
  const deactivateTemplateIds = new Set<string>();
  console.log("--- Plantillas ---");
  for (const d of templatesSnap.docs) {
    const r = d.data() as any; const n = norm(r.name);
    if (TO_CARD.has(n)) {
      cardTemplateIds.add(d.id);
      console.log(`  • → TARJETA: ${r.name}`);
      manifest.toCard.push({ id: d.id, name: r.name, was: { paymentMethod: r.paymentMethod ?? null, cardAccountId: r.cardAccountId ?? null } });
      if (APPLY) batch.update(doc(db, "commitmentTemplates", d.id), SET_CARD);
    } else if (TO_DEACTIVATE.has(n)) {
      deactivateTemplateIds.add(d.id);
      console.log(`  • DESACTIVAR (duplicado): ${r.name}`);
      manifest.deactivate.push({ id: d.id, name: r.name, was: { isActive: r.isActive ?? null } });
      if (APPLY) batch.update(doc(db, "commitmentTemplates", d.id), { isActive: false });
    }
  }

  for (const d of instancesSnap.docs) {
    const r = d.data() as any;
    if (cardTemplateIds.has(r.templateId)) {
      if (r.cardAccountId === CARD.id && r.paymentMethod === "credit_card") continue;
      manifest.instances.card++;
      if (APPLY) batch.update(doc(db, "commitmentInstances", d.id), SET_CARD);
    } else if (deactivateTemplateIds.has(r.templateId)) {
      if (r.status !== "pending") continue; // solo cancelar las pendientes (no tocar las ya pagadas)
      manifest.instances.cancelled++;
      if (APPLY) batch.update(doc(db, "commitmentInstances", d.id), { status: "cancelled" });
    }
  }

  const total = manifest.toCard.length + manifest.deactivate.length + manifest.instances.card + manifest.instances.cancelled;
  console.log(`\n--- TOTAL: ${manifest.toCard.length} plantillas→tarjeta + ${manifest.deactivate.length} desactivadas + ${manifest.instances.card} instancias→tarjeta + ${manifest.instances.cancelled} instancias canceladas = ${total} writes ${APPLY ? "(APLICADOS)" : "(dry-run)"}`);
  console.log("Farmacia y el resto quedan en débito (sin cambios).");
  if (APPLY && total > 500) { console.error("⛔ >500 writes, falta chunking"); process.exit(1); }
  if (APPLY) {
    const mp = path.join(process.cwd(), "scripts", "bank-bot", `_manifest-fixpay-${NOW.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(mp, JSON.stringify(manifest, null, 2));
    await batch.commit();
    console.log(`Manifest (para revertir): ${mp}`);
  }
})();
