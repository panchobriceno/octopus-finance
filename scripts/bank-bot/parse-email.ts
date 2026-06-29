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

/** Santander "Aviso de Transferencia de Fondos" (mensajeria@santander.cl). */
export function parseSantanderTransfer(raw: string): SeedNoBatch | null {
  const text = String(raw).replace(/\s+/g, " ");
  const isIn = /ha recibido una transferencia/i.test(text);
  const isOut = /ha realizado una transferencia/i.test(text);
  if (!isIn && !isOut) return null;
  const amountM = text.match(/\$\s*([\d.]+)/);
  const dateM = text.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!amountM || !dateM) return null;
  const amount = clp(amountM[1]);
  const date = `${dateM[3]}-${dateM[2]}-${dateM[1]}`;
  if (amount <= 0) return null;

  let party = "";
  if (isOut) {
    const m = text.match(/Nombre\s+(.+?)\s+Mensaje/i);
    party = m ? m[1].trim() : "";
  } else {
    const m = text.match(/Titular cuenta origen\s+(.+?)\s+(?:Banco|Numero|RUT)/i);
    party = m ? m[1].trim() : "";
  }
  const desc = isOut
    ? `Transferencia a ${party || "destinatario"}`
    : `Transferencia de ${party || "origen"}`;

  return {
    source: "email",
    sourceName: "Santander Cuenta Corriente 0-000-7387399-1",
    sourceType: "bank_account",
    bankName: "Banco Santander",
    date,
    description: desc,
    amount,
    direction: isIn ? "income" : "expense",
    category: "Sin categoría",
    workspace: "business",
    movementType: isIn ? "income" : "expense",
    paymentMethod: "bank_account",
    createdAt: NOW,
  };
}

// ----------------------------- test con la muestra real -----------------------------
const SAMPLE_SAN_OUT = `Aviso de Transferencia de Fondos FRANCISCO ESTEBAN BRICEÑO AGUAYO, ha realizado una transferencia Estimado: FRANCISCO ESTEBAN BRICEÑO AGUAYO Origen Tipo de cuenta Cuenta Nº Cuenta Corriente 0-000-7387399-1 RUT Razon Social 76.901.502-7 AGENCIA OCTOPUS SPA Destino Banco Tipo de cuenta SCOTIABANK AZUL Cuenta Corriente Cuenta Nº RUT 000-000009-9331633-4 78.318.778-7 Nombre Da Ponte Pulgar Spa Mensaje Monto de transferencia 16-06-2026 $ 66.000`;
const SAMPLE_SAN_IN = `Aviso de Transferencia de Fondos Francisco Briceño, ha recibido una transferencia Estimado: Francisco Briceño De acuerdo con lo instruido por nuestro cliente AGENCIA OCTOPUS SPA Detalle de la operación Rut cuenta origen Titular cuenta origen 76.901.502-7 AGENCIA OCTOPUS SPA Banco de Origen Numero de la operacion Santander 20260616130470189139 Monto transferido 16-06-2026 $ 3.000.000`;

const SAMPLE_EDWARDS = `Francisco Esteban Briceno Aguayo:
Te informamos que se ha realizado una compra por $320.000 con Tarjeta de
Crédito ****7232 en MP *DECATHLON el 24/06/2026 22:18.
Revisa Saldos y Movimientos en App Mi Banco o Banco en Línea.`;

if (process.argv[1] && process.argv[1].endsWith("parse-email.ts")) {
  console.log("Edwards compra:", JSON.stringify(parseEdwardsCardPurchase(SAMPLE_EDWARDS)));
  console.log("Santander salida:", JSON.stringify(parseSantanderTransfer(SAMPLE_SAN_OUT)));
  console.log("Santander entrada:", JSON.stringify(parseSantanderTransfer(SAMPLE_SAN_IN)));
}
