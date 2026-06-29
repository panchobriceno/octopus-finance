/**
 * Parser del EECC (estado de cuenta) de la tarjeta de credito Santander Visa Empresa ****6101.
 * Usa pdftotext -layout (poppler). Maneja los DOS PDFs:
 *  - NACIONAL ("ESTADO DE CUENTA EN MONEDA NACIONAL"): cargos en CLP. EXCLUYE "TRASPASO A DEUDA
 *    NACIONAL" (es el bulto de lo internacional, que itemizamos aparte -> no duplicar).
 *  - INTERNACIONAL ("ESTADO DE CUENTA INTERNACIONAL"): cargos en US$ con columna MONTO MONEDA
 *    ORIGEN + MONTO US$. CLP de cada item:
 *      · si MONTO ORIGEN != MONTO US$  -> el origen YA es CLP (ej. Facebook 50.000 CLP) -> usar origen.
 *      · si MONTO ORIGEN == MONTO US$  -> facturado en USD (ej. Google Workspace) -> CLP = US$ * tasa.
 *    La TASA se deriva del propio EECC (mediana de origenCLP/US$ en los items CLP). Sin API externa.
 *
 * Probar:  npx tsx scripts/bank-bot/parse-santander-eecc.ts <pdf-nacional> <pdf-internacional>
 */
import { execFileSync } from "node:child_process";
import type { SeedNoBatch } from "./parse-edwards";

const PDFTOTEXT = "/opt/homebrew/bin/pdftotext";
const NOW = "2026-06-29T00:00:00.000Z";

const SANTANDER_CARD = {
  source: "pdf" as const,
  sourceName: "Santander Tarjeta ****6101",
  sourceType: "credit_card" as const,
  bankName: "Banco Santander",
  creditCardName: "Santander Visa Empresa ****6101",
  accountId: null,
  workspace: "business",
  paymentMethod: "credit_card" as const,
};

const clpInt = (s: string) => Number(String(s).replace(/[^\d-]/g, "")) || 0;          // "$32.368" -> 32368
const clNum = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".")) || 0; // "50.000,00" -> 50000 ; "55,90" -> 55.9
const ddmyyToIso = (d: string) => { const m = d.match(/(\d{2})\/(\d{2})\/(\d{2})(?!\d)/); return m ? `20${m[3]}-${m[2]}-${m[1]}` : null; };

function pdfText(pdfPath: string): string {
  return execFileSync(PDFTOTEXT, ["-layout", pdfPath, "-"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function isInternacional(text: string): boolean {
  return /ESTADO DE CUENTA INTERNACIONAL/i.test(text);
}

/** NACIONAL: lineas con fecha dd/mm/yy + ultimo monto "$...". Excluye traspaso y pagos (negativos). */
export function parseNacional(text: string): SeedNoBatch[] {
  const out: SeedNoBatch[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    const dm = line.match(/(\d{2}\/\d{2}\/\d{2})(?!\d)/);
    if (!dm) continue;
    if (/traspaso a deuda nacional/i.test(line)) continue;        // lo itemizamos via internacional
    const amts = [...line.matchAll(/\$\s*(-?[\d.]+)/g)].map((m) => clpInt(m[1]));
    if (!amts.length) continue;
    const amount = amts[amts.length - 1];
    if (amount <= 0) continue;                                     // MONTO CANCELADO / abonos -> pago, no gasto
    const date = ddmyyToIso(dm[1]); if (!date) continue;
    const desc = line.slice(line.indexOf(dm[1]) + dm[1].length).split("$")[0].replace(/\s+/g, " ").trim();
    if (!desc) continue;
    out.push({ ...SANTANDER_CARD, date, description: desc, amount, direction: "expense", category: "Sin categoría", movementType: "expense", createdAt: NOW });
  }
  return out;
}

/** INTERNACIONAL: columnas separadas por 2+ espacios; ultimas dos = MONTO ORIGEN, MONTO US$. */
export function parseInternacional(text: string): SeedNoBatch[] {
  const rows: { date: string; desc: string; origen: number; usd: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const dm = raw.match(/(\d{2}\/\d{2}\/\d{2})(?!\d)/);
    if (!dm) continue;
    if (/traspaso de deuda internacional/i.test(raw)) continue;   // reverso interno
    const after = raw.slice(raw.indexOf(dm[1]) + dm[1].length);
    const cols = after.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cols.length < 3) continue;
    const usd = clNum(cols[cols.length - 1]);
    const origen = clNum(cols[cols.length - 2]);
    const desc = cols[0];
    if (!desc || (usd <= 0 && origen <= 0)) continue;             // skip abonos/negativos
    const date = ddmyyToIso(dm[1]); if (!date) continue;
    rows.push({ date, desc, origen, usd });
  }
  // ratio origen/usd: ~1 => facturado en USD ; ~900 => origen ya es CLP. Banda CLP/USD plausible 600-1300.
  const ratio = (r: { origen: number; usd: number }) => (r.usd > 0 ? r.origen / r.usd : Infinity);
  const isClpBilled = (r: { origen: number; usd: number }) => ratio(r) >= 50; // 50 separa ~1 (USD) de ~900 (CLP)
  const rateRows = rows.filter((r) => r.usd >= 1 && ratio(r) >= 600 && ratio(r) <= 1300).map(ratio).sort((a, b) => a - b);
  const rate = rateRows.length ? rateRows[Math.floor(rateRows.length / 2)] : 0;
  const out: SeedNoBatch[] = [];
  for (const r of rows) {
    let clp: number;
    if (isClpBilled(r)) {
      clp = Math.round(r.origen);                                  // origen ya es CLP
    } else {                                                       // facturado en USD -> convertir
      if (!rate) throw new Error(`EECC internacional con cargos en USD pero sin tasa CLP/USD derivable (no hay items CLP en el estado). Revisar a mano: "${r.desc}" US$${r.usd}`);
      clp = Math.round(r.usd * rate);
    }
    if (clp <= 0) continue;
    out.push({ ...SANTANDER_CARD, date: r.date, description: r.desc, amount: clp, direction: "expense", category: "Sin categoría", movementType: "expense", createdAt: NOW });
  }
  return out;
}

export function parseSantanderEeccPdf(pdfPath: string): SeedNoBatch[] {
  const text = pdfText(pdfPath);
  return isInternacional(text) ? parseInternacional(text) : parseNacional(text);
}

// ----------------------------- test -----------------------------
if (process.argv[1] && process.argv[1].endsWith("parse-santander-eecc.ts")) {
  for (const p of process.argv.slice(2)) {
    const text = pdfText(p);
    const tipo = isInternacional(text) ? "INTERNACIONAL" : "NACIONAL";
    const seeds = parseSantanderEeccPdf(p);
    console.log(`\n=== ${tipo}: ${p.split("/").pop()} -> ${seeds.length} movimientos ===`);
    for (const s of seeds) console.log(`  ${s.date} $${s.amount.toLocaleString("es-CL")}  ${s.description}`);
    console.log(`  TOTAL: $${seeds.reduce((a, s) => a + s.amount, 0).toLocaleString("es-CL")}`);
  }
}
