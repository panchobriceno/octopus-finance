/**
 * Parser de EECC (estado de cuenta) de tarjeta de crédito — Banco de Chile / Santander / Edwards
 * (mismo layout). Usa pdftotext -layout (poppler), con soporte de contraseña (-upw) para los PDF
 * encriptados de Edwards.
 *  - Detecta la TARJETA del encabezado ("N° DE TARJETA ... 7232/6101") y fija identidad + ámbito.
 *  - NACIONAL ("ESTADO DE CUENTA ... NACIONAL"): cargos en CLP. EXCLUYE "TRASPASO A DEUDA NACIONAL".
 *  - INTERNACIONAL: columnas MONTO MONEDA ORIGEN + MONTO US$. Si origen≠usd el origen ya es CLP;
 *    si origen≈usd está facturado en USD -> CLP = us$ * tasa derivada del propio EECC.
 *
 * Probar:  npx tsx scripts/bank-bot/parse-santander-eecc.ts [--pass=XXXX] <pdf...>
 */
import { execFileSync } from "node:child_process";
import type { SeedNoBatch } from "./parse-edwards";

const PDFTOTEXT = "/opt/homebrew/bin/pdftotext";
const NOW = "2026-06-29T00:00:00.000Z";

type CardId = { sourceName: string; creditCardName: string; bankName: string; workspace: string };
// Identidad por ultimos-4 de la tarjeta (del encabezado del EECC).
const CARDS: Record<string, CardId> = {
  "6101": { sourceName: "Santander Tarjeta ****6101", creditCardName: "Santander Visa Empresa ****6101", bankName: "Banco Santander", workspace: "business" },
  "7232": { sourceName: "Edwards Tarjeta ****7232", creditCardName: "T.C Edwards Pancho", bankName: "Banco Edwards", workspace: "family" },
};
function cardIdentity(text: string): CardId {
  let last4: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/de tarjeta de cr/i.test(line)) { const g = line.match(/\d{4}/g); if (g) { last4 = g[g.length - 1]; break; } }
  }
  if (last4 && CARDS[last4]) return CARDS[last4];
  return { sourceName: `Tarjeta ****${last4 ?? "?"}`, creditCardName: `Tarjeta ****${last4 ?? "?"} (revisar)`, bankName: "Banco", workspace: "family" };
}
function baseSeed(id: CardId) {
  return { source: "pdf" as const, sourceName: id.sourceName, sourceType: "credit_card" as const, bankName: id.bankName, creditCardName: id.creditCardName, accountId: null, workspace: id.workspace, paymentMethod: "credit_card" as const, createdAt: NOW };
}

const clpInt = (s: string) => Number(String(s).replace(/[^\d-]/g, "")) || 0;
const clNum = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".")) || 0;
const ddmyyToIso = (d: string) => { const m = d.match(/(\d{2})\/(\d{2})\/(\d{2})(?!\d)/); return m ? `20${m[3]}-${m[2]}-${m[1]}` : null; };

function pdfText(pdfPath: string, password?: string): string {
  const args = ["-layout"]; if (password) args.push("-upw", password); args.push(pdfPath, "-");
  return execFileSync(PDFTOTEXT, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
function isInternacional(text: string): boolean { return /ESTADO DE CUENTA INTERNACIONAL/i.test(text); }

export function parseNacional(text: string, id: CardId): SeedNoBatch[] {
  const base = baseSeed(id);
  const out: SeedNoBatch[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    const dm = line.match(/(\d{2}\/\d{2}\/\d{2})(?!\d)/);
    if (!dm) continue;
    if (/traspaso a deuda nacional/i.test(line)) continue;
    const amts = [...line.matchAll(/\$\s*(-?[\d.]+)/g)].map((m) => clpInt(m[1]));
    if (!amts.length) continue;
    const amount = amts[amts.length - 1];
    if (amount <= 0) continue;
    const date = ddmyyToIso(dm[1]); if (!date) continue;
    const desc = line.slice(line.indexOf(dm[1]) + dm[1].length).split("$")[0].replace(/\s+/g, " ").trim();
    if (!desc) continue;
    out.push({ ...base, date, description: desc, amount, direction: "expense", category: "Sin categoría", movementType: "expense" });
  }
  return out;
}

export function parseInternacional(text: string, id: CardId): SeedNoBatch[] {
  const base = baseSeed(id);
  const rows: { date: string; desc: string; origen: number; usd: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const dm = raw.match(/(\d{2}\/\d{2}\/\d{2})(?!\d)/);
    if (!dm) continue;
    if (/traspaso de deuda internacional/i.test(raw)) continue;
    const after = raw.slice(raw.indexOf(dm[1]) + dm[1].length);
    const cols = after.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cols.length < 3) continue;
    const usd = clNum(cols[cols.length - 1]);
    const origen = clNum(cols[cols.length - 2]);
    const desc = cols[0];
    if (!desc || (usd <= 0 && origen <= 0)) continue;
    const date = ddmyyToIso(dm[1]); if (!date) continue;
    rows.push({ date, desc, origen, usd });
  }
  const ratio = (r: { origen: number; usd: number }) => (r.usd > 0 ? r.origen / r.usd : Infinity);
  const isClpBilled = (r: { origen: number; usd: number }) => ratio(r) >= 50;
  const rateRows = rows.filter((r) => r.usd >= 1 && ratio(r) >= 600 && ratio(r) <= 1300).map(ratio).sort((a, b) => a - b);
  const rate = rateRows.length ? rateRows[Math.floor(rateRows.length / 2)] : 0;
  const out: SeedNoBatch[] = [];
  for (const r of rows) {
    let clp: number;
    if (isClpBilled(r)) clp = Math.round(r.origen);
    else { if (!rate) throw new Error(`EECC internacional con cargos USD sin tasa derivable (${id.creditCardName}). Revisar: "${r.desc}" US$${r.usd}`); clp = Math.round(r.usd * rate); }
    if (clp <= 0) continue;
    out.push({ ...base, date: r.date, description: r.desc, amount: clp, direction: "expense", category: "Sin categoría", movementType: "expense" });
  }
  return out;
}

export function parseSantanderEeccPdf(pdfPath: string, password?: string): SeedNoBatch[] {
  const text = pdfText(pdfPath, password);
  const id = cardIdentity(text);
  return isInternacional(text) ? parseInternacional(text, id) : parseNacional(text, id);
}

if (process.argv[1] && process.argv[1].endsWith("parse-santander-eecc.ts")) {
  const passArg = process.argv.find((a) => a.startsWith("--pass="));
  const pass = passArg ? passArg.split("=")[1] : undefined;
  for (const p of process.argv.slice(2).filter((a) => a.toLowerCase().endsWith(".pdf"))) {
    const text = pdfText(p, pass);
    const id = cardIdentity(text);
    const tipo = isInternacional(text) ? "INTERNACIONAL" : "NACIONAL";
    const seeds = parseSantanderEeccPdf(p, pass);
    console.log(`\n=== ${id.creditCardName} ${tipo}: ${p.split("/").pop()} -> ${seeds.length} mov ===`);
    for (const s of seeds) console.log(`  ${s.date} $${s.amount.toLocaleString("es-CL")}  ${s.description}`);
    console.log(`  TOTAL: $${seeds.reduce((a, s) => a + s.amount, 0).toLocaleString("es-CL")}`);
  }
}
