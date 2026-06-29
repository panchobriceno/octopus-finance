/**
 * Parsers de correos del banco -> semillas de movimiento (SeedNoBatch).
 * Por ahora: Edwards "Compra con Tarjeta de Credito" (enviodigital@bancoedwards.cl).
 * Se iran agregando: Santander "Aviso de Transferencia", "Comprobante de Pago", cartola ZIP.
 *
 * Probar:  npx tsx scripts/bank-bot/parse-email.ts   (corre el test con la muestra real)
 */
import type { SeedNoBatch } from "./parse-edwards";

const NOW = "2026-06-29T00:00:00.000Z";

function clp(s: string): number {
  return Number(String(s).replace(/\./g, "").replace(/[^\d-]/g, "")) || 0;
}
function dmyToIso(d: string): string | null {
  const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Edwards: "compra por $320.000 con Tarjeta de Credito ****7232 en MP *DECATHLON el 24/06/2026 22:18" */
export function parseEdwardsCardPurchase(raw: string): SeedNoBatch | null {
  const text = String(raw).replace(/\s+/g, " ");
  const m = text.match(
    /compra por \$([\d.]+) con Tarjeta de Cr[eé]dito \*+(\d+) en (.+?) el (\d{2}\/\d{2}\/\d{4})/i,
  );
  if (!m) return null;
  const amount = clp(m[1]);
  const card = m[2];
  const merchant = m[3].replace(/\s+/g, " ").trim();
  const date = dmyToIso(m[4]);
  if (!date || amount <= 0) return null;
  return {
    source: "email",
    sourceName: `Edwards Tarjeta ****${card}`,
    sourceType: "credit_card",
    creditCardName: `Edwards Visa ****${card}`,
    bankName: "Banco Edwards",
    date,
    description: merchant,
    amount,
    direction: "expense",
    category: "Sin categoría",
    workspace: "business",
    movementType: "expense",
    paymentMethod: "credit_card",
    createdAt: NOW,
  };
}

// ----------------------------- test con la muestra real -----------------------------
const SAMPLE_EDWARDS = `Francisco Esteban Briceno Aguayo:
Te informamos que se ha realizado una compra por $320.000 con Tarjeta de
Crédito ****7232 en MP *DECATHLON el 24/06/2026 22:18.
Revisa Saldos y Movimientos en App Mi Banco o Banco en Línea.`;

if (process.argv[1] && process.argv[1].endsWith("parse-email.ts")) {
  const seed = parseEdwardsCardPurchase(SAMPLE_EDWARDS);
  console.log("Edwards card purchase parse:");
  console.log(JSON.stringify(seed, null, 2));
}
