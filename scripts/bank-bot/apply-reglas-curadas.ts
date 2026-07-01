/**
 * Aplica el set de reglas curado con Pancho (2026-07-01): renombra categoría,
 * crea categorías/subcategorías nuevas y crea reglas (con subcategoría + rango de monto).
 * IDEMPOTENTE: no duplica categorías/items/reglas ya existentes.
 *
 *   npx tsx scripts/bank-bot/apply-reglas-curadas.ts --dry   (muestra, no escribe)
 *   npx tsx scripts/bank-bot/apply-reglas-curadas.ts         (aplica)
 */
import { addDoc, collection, doc, getDocs, updateDoc } from "firebase/firestore/lite";
import { getAuthedDb } from "./_db";

const DRY = process.argv.includes("--dry");
const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const NOTE = "Curada con Pancho 2026-07-01";

// Categorías nuevas (Familia, egreso). "Salida a Comer" NO va acá: es subcategoría de Comida.
const NEW_CATEGORIES = ["Estacionamiento", "Ropa", "Compras Online"];
// Subcategorías (items) nuevas: [nombre item, categoría padre, tipo, ámbito]
const NEW_ITEMS: [string, string, "income" | "expense", string][] = [
  ["Higgsfield", "Software Empresa", "expense", "business"],
  ["Adobe Cloud", "Adobe Creative Cloud", "expense", "business"],
  ["Salida a Comer", "Comida", "expense", "family"],
  ["Regalos", "Otros", "expense", "family"],
  ["Martina", "Otros", "expense", "family"],
];

type R = { kw: string; cat: string; ws: string; mt: string; pm: string; item?: string; min?: number; max?: number; prio?: number; nameOverride?: string };
const RULES: R[] = [
  // Software / IA (business, tarjeta)
  { kw: "claude", cat: "Software Empresa", ws: "business", mt: "expense", pm: "credit_card", item: "Claude", prio: 5 },
  { kw: "anthropic", cat: "Software Empresa", ws: "business", mt: "expense", pm: "credit_card", item: "Claude", prio: 5 },
  { kw: "github", cat: "Software Empresa", ws: "business", mt: "expense", pm: "credit_card", item: "Github", prio: 5 },
  { kw: "hubspot", cat: "Software Empresa", ws: "business", mt: "expense", pm: "credit_card", item: "Hubspot", prio: 5 },
  { kw: "metricool", cat: "Software Empresa", ws: "business", mt: "expense", pm: "credit_card", item: "Metricool", prio: 5 },
  { kw: "slack", cat: "Software Empresa", ws: "business", mt: "expense", pm: "credit_card", item: "Slack", prio: 5 },
  { kw: "higgsfield", cat: "Software Empresa", ws: "business", mt: "expense", pm: "credit_card", item: "Higgsfield", prio: 5 },
  { kw: "workspace", cat: "Software Empresa", ws: "business", mt: "expense", pm: "credit_card", item: "Google Suite", prio: 5 },
  { kw: "freepik", cat: "Software Empresa", ws: "business", mt: "expense", pm: "credit_card", prio: 5 },
  { kw: "magnific", cat: "Magnific", ws: "business", mt: "expense", pm: "credit_card", prio: 5 },
  { kw: "adobe", cat: "Adobe Creative Cloud", ws: "business", mt: "expense", pm: "credit_card", item: "Adobe Cloud", prio: 5 },
  // Digital (family, tarjeta). apple acotado <80k; el resto por comercio.
  { kw: "apple", cat: "Digital", ws: "family", mt: "expense", pm: "credit_card", max: 79999, prio: 5, nameOverride: "Apple suscripciones (< 80k)" },
  { kw: "prime", cat: "Digital", ws: "family", mt: "expense", pm: "credit_card", item: "Prime Video", prio: 5 },
  { kw: "amazon", cat: "Digital", ws: "family", mt: "expense", pm: "credit_card", item: "Prime Video", prio: 5 },
  { kw: "netflix", cat: "Digital", ws: "family", mt: "expense", pm: "credit_card", item: "Netflix", prio: 5 },
  { kw: "youtube", cat: "Digital", ws: "family", mt: "expense", pm: "credit_card", item: "Youtube Premium", prio: 5 },
  { kw: "suno", cat: "Digital", ws: "family", mt: "expense", pm: "credit_card", prio: 5 },
  // ChatGPT vía Apple: mismo texto que las subs, aislado por monto (>= 80k) y prioridad alta.
  { kw: "apple", cat: "Software Empresa", ws: "business", mt: "expense", pm: "credit_card", item: "Chat GPT", min: 80000, prio: 10, nameOverride: "ChatGPT vía Apple (>= 80k)" },
  // Comida (family, tarjeta)
  { kw: "jumbo", cat: "Comida", ws: "family", mt: "expense", pm: "credit_card", prio: 5 },
  { kw: "super", cat: "Comida", ws: "family", mt: "expense", pm: "credit_card", prio: 5 },
  // Banco (family, tarjeta)
  { kw: "comision", cat: "Comisiones bancarias", ws: "family", mt: "expense", pm: "credit_card", prio: 5 },
  { kw: "administracion", cat: "Comisiones bancarias", ws: "family", mt: "expense", pm: "credit_card", prio: 5 },
  { kw: "rotativos", cat: "Intereses bancarios", ws: "family", mt: "expense", pm: "credit_card", prio: 5 },
  { kw: "mora", cat: "Intereses bancarios", ws: "family", mt: "expense", pm: "credit_card", prio: 5 },
  // Seguros (family, tarjeta)
  { kw: "seguros", cat: "Seguros Complementarios", ws: "family", mt: "expense", pm: "credit_card", prio: 5 },
  { kw: "banchile", cat: "Seguros Complementarios", ws: "family", mt: "expense", pm: "credit_card", prio: 5 },
  // Auto (family, cuenta) → Bencina
  { kw: "antu", cat: "Auto", ws: "family", mt: "expense", pm: "bank_account", item: "Bencina", prio: 5 },
  { kw: "combustibles", cat: "Auto", ws: "family", mt: "expense", pm: "bank_account", item: "Bencina", prio: 5 },
  { kw: "lauquen", cat: "Auto", ws: "family", mt: "expense", pm: "bank_account", item: "Bencina", prio: 5 },
  // Padel (family, cuenta)
  { kw: "padel", cat: "Padel", ws: "family", mt: "expense", pm: "bank_account", prio: 5 },
  { kw: "bravo", cat: "Padel", ws: "family", mt: "expense", pm: "bank_account", prio: 5 },
  { kw: "country", cat: "Padel", ws: "family", mt: "expense", pm: "bank_account", prio: 5 },
  // Compras Online (family, tarjeta). Solo "mercado libre" (marketplace online); la palabra
  // "mercado" sola NO se auto-asigna (aparece en POS presencial de MercadoPago) → se edita a mano.
  { kw: "mercado libre", cat: "Compras Online", ws: "family", mt: "expense", pm: "credit_card", prio: 5 },
  // Ingresos clientes (business, cuenta)
  { kw: "educacion", cat: "Ingresos Clientes", ws: "business", mt: "income", pm: "bank_account", prio: 5 },
  { kw: "instituto", cat: "Ingresos Clientes", ws: "business", mt: "income", pm: "bank_account", prio: 5 },
];

(async () => {
  const db = await getAuthedDb();
  const cats = (await getDocs(collection(db, "categories"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const items = (await getDocs(collection(db, "items"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const rules = (await getDocs(collection(db, "movementRules"))).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const findCat = (name: string, type: string, ws: string) => {
    const cands = cats.filter((c: any) => norm(c.name) === norm(name) && c.type === type);
    return cands.find((c: any) => !c.workspace || c.workspace === ws) ?? cands[0] ?? null;
  };
  const findItem = (name: string, catId: string) => items.find((i: any) => norm(i.name) === norm(name) && i.categoryId === catId) ?? null;
  const log = (s: string) => console.log(s);

  log(`\n${DRY ? "[DRY] " : ""}=== 1. RENOMBRAR CATEGORÍA ===`);
  const adobe = cats.find((c: any) => norm(c.name) === "adobe creative cloude" && c.workspace === "business");
  if (adobe) {
    log(`  "Adobe Creative Cloude" → "Adobe Creative Cloud"`);
    if (!DRY) await updateDoc(doc(db, "categories", adobe.id), { name: "Adobe Creative Cloud" });
    adobe.name = "Adobe Creative Cloud";
  } else log(`  (ya renombrada o no existe "Adobe Creative Cloude")`);

  log(`\n${DRY ? "[DRY] " : ""}=== 2. CATEGORÍAS NUEVAS (family, egreso) ===`);
  for (const name of NEW_CATEGORIES) {
    if (findCat(name, "expense", "family")) { log(`  ya existe: ${name}`); continue; }
    log(`  crear categoría: ${name}`);
    if (!DRY) { const r = await addDoc(collection(db, "categories"), { name, type: "expense", color: null, workspace: "family" }); cats.push({ id: r.id, name, type: "expense", workspace: "family" }); }
    else cats.push({ id: `dry-${name}`, name, type: "expense", workspace: "family" });
  }

  log(`\n${DRY ? "[DRY] " : ""}=== 3. SUBCATEGORÍAS NUEVAS ===`);
  for (const [name, catName, type, ws] of NEW_ITEMS) {
    const cat = findCat(catName, type, ws);
    if (!cat) { log(`  ⚠ NO se puede crear "${name}": falta categoría "${catName}" (${type}/${ws})`); continue; }
    if (findItem(name, cat.id)) { log(`  ya existe: ${name} (en ${catName})`); continue; }
    log(`  crear subcategoría: ${name} → ${catName} [${ws}]`);
    if (!DRY) { const r = await addDoc(collection(db, "items"), { name, categoryId: cat.id }); items.push({ id: r.id, name, categoryId: cat.id }); }
    else items.push({ id: `dry-${name}`, name, categoryId: cat.id });
  }

  log(`\n${DRY ? "[DRY] " : ""}=== 4. REGLAS ===`);
  const dedupe = new Set(rules.map((r: any) => `${(r.keywords?.[0] ?? "").toLowerCase()}|${r.amountMin ?? ""}|${r.amountMax ?? ""}`));
  let created = 0, skipped = 0, blocked = 0;
  const now = new Date().toISOString();
  for (const r of RULES) {
    const dedupeKey = `${r.kw.toLowerCase()}|${r.min ?? ""}|${r.max ?? ""}`;
    if (dedupe.has(dedupeKey)) { log(`  ya existe (skip): "${r.kw}"${r.min || r.max ? ` [${r.min ?? ""}-${r.max ?? ""}]` : ""}`); skipped++; continue; }
    const type = r.mt === "income" ? "income" : "expense";
    const cat = findCat(r.cat, type, r.ws);
    if (!cat) { log(`  ⚠ BLOQUEADA "${r.kw}": no existe categoría "${r.cat}" (${type}/${r.ws})`); blocked++; continue; }
    let itemId: string | null = null;
    if (r.item) {
      const it = findItem(r.item, cat.id);
      if (!it) { log(`  ⚠ BLOQUEADA "${r.kw}": no existe subcategoría "${r.item}" en "${r.cat}"`); blocked++; continue; }
      itemId = it.id;
    }
    const payload = {
      name: r.nameOverride ?? `Curada: ${r.kw}`,
      keywords: [r.kw], category: r.cat, itemId,
      workspace: r.ws, movementType: r.mt, paymentMethod: r.pm,
      accountId: null, creditCardName: null, cardAccountId: null,
      amountDirection: type, amountMin: r.min ?? null, amountMax: r.max ?? null,
      priority: r.prio ?? 5, isActive: true, notes: NOTE, createdAt: now, updatedAt: now,
    };
    log(`  crear: "${r.kw}" → ${r.cat}${r.item ? ` › ${r.item}` : ""} [${r.ws}/${r.mt}]${r.min || r.max ? ` monto ${r.min ?? 0}-${r.max ?? "∞"}` : ""} prio ${payload.priority}`);
    if (!DRY) await addDoc(collection(db, "movementRules"), payload);
    dedupe.add(dedupeKey); created++;
  }
  log(`\n${DRY ? "[DRY] " : ""}RESUMEN reglas: ${created} a crear · ${skipped} ya existían · ${blocked} bloqueadas`);
  if (DRY) log("\n(no se escribió nada — saca --dry para aplicar)\n");
  else log("\n✅ Aplicado.\n");
})().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
