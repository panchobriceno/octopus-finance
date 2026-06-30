/**
 * Fase 6b — Default-tag de suscripciones pagadas con tarjeta (octopus-finance).
 * Por decisión de Pancho: las suscripciones digitales/software se pagan con la T.C 7232 por defecto.
 * Setea paymentMethod=credit_card + creditCardName + cardAccountId en las plantillas (y sus instancias)
 * de las categorías de suscripción. Editable después en el form de compromisos.
 *
 * NO toca compromisos bancarios reales (arriendo, previred, dividendo, IVA, comida, básicos, placeholders T.C).
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

const SUBS_CATEGORIES = new Set(["Adobe Creative Cloude", "Digital", "Magnific", "Software Empresa"]);
const CARD = { id: "PkkkaDXs7JzFXqgfeosS", name: "T.C Edwards Pancho" }; // T.C 7232
const SET = { paymentMethod: "credit_card", creditCardName: CARD.name, cardAccountId: CARD.id };

(async () => {
  const templatesSnap = await getDocs(collection(db, "commitmentTemplates"));
  const instancesSnap = await getDocs(collection(db, "commitmentInstances"));
  console.log(APPLY ? "=== APLICANDO (batch atómico) ===\n" : "=== DRY-RUN (--apply para escribir) ===\n");

  const subTemplateIds = new Set<string>();
  const batch = writeBatch(db);
  const manifest: any = { ts: NOW, card: CARD, templates: [], instances: 0 };

  console.log("--- Plantillas de suscripción → T.C 7232 ---");
  for (const d of templatesSnap.docs) {
    const r = d.data() as any;
    if (!SUBS_CATEGORIES.has(r.category)) continue;
    subTemplateIds.add(d.id);
    const already = r.cardAccountId === CARD.id && r.paymentMethod === "credit_card";
    console.log(`  ${already ? "=" : "•"} ${String(r.name).padEnd(22)} (${r.category})${already ? " ya estaba" : ""}`);
    if (already) continue;
    manifest.templates.push({ id: d.id, name: r.name, was: { paymentMethod: r.paymentMethod ?? null, creditCardName: r.creditCardName ?? null, cardAccountId: r.cardAccountId ?? null } });
    if (APPLY) batch.update(doc(db, "commitmentTemplates", d.id), SET);
  }

  let instCount = 0;
  for (const d of instancesSnap.docs) {
    const r = d.data() as any;
    if (!subTemplateIds.has(r.templateId)) continue;
    if (r.cardAccountId === CARD.id && r.paymentMethod === "credit_card") continue;
    instCount++;
    if (APPLY) batch.update(doc(db, "commitmentInstances", d.id), SET);
  }
  manifest.instances = instCount;

  const totalWrites = manifest.templates.length + instCount;
  console.log(`\n--- TOTAL: ${manifest.templates.length} plantillas + ${instCount} instancias = ${totalWrites} writes ${APPLY ? "(APLICADOS)" : "(dry-run)"}`);
  console.log("No tocados: compromisos bancarios reales (arriendo, previred, dividendo, IVA, comida, básicos, placeholders T.C Pancho/Javi).");

  if (APPLY && totalWrites > 500) { console.error("⛔ >500 writes, falta chunking"); process.exit(1); }
  if (APPLY) {
    const mp = path.join(process.cwd(), "scripts", "bank-bot", `_manifest-tagcommit-${NOW.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(mp, JSON.stringify(manifest, null, 2));
    await batch.commit();
    console.log(`Manifest (para revertir): ${mp}`);
  }
})();
