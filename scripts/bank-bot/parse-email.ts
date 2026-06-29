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

/**
 * IDENTIDAD DE FUENTE (config unica). OJO: creditCardName y accountId NO son metadata
 * cosmetica — son parte del dedupeKey (ver buildMovementDedupeKey en bank-imports.ts) y de
 * las claves de match de transacciones. Por eso se fijan ACA, en un solo lugar, y se aplican
 * ANTES de construir el movimiento. Cambiar estos valores cambia la identidad de duplicados.
 */
type SourceIdentity = {
  sourceName: string;
  sourceType: "credit_card" | "bank_account";
  bankName: string;
  creditCardName: string | null;
  accountId: string | null;
  workspace: string;
  paymentMethod: "credit_card" | "bank_account";
};

// Tarjetas Edwards por ultimos-4 del numero que viene en el correo.
const EDWARDS_CARDS: Record<string, SourceIdentity> = {
  "7232": {
    sourceName: "Edwards Tarjeta ****7232",
    sourceType: "credit_card",
    bankName: "Banco Edwards",
    creditCardName: "T.C Edwards Pancho", // nombre real de la cuenta-tarjeta en la app
    accountId: null,
    workspace: "family", // la tarjeta Edwards de Pancho es personal
    paymentMethod: "credit_card",
  },
};

function edwardsCardIdentity(last4: string): SourceIdentity {
  const known = EDWARDS_CARDS[last4];
  if (known) return known;
  // Tarjeta desconocida: NO adivinar el nombre real (rompe identidad/dedup). Queda con un
  // nombre descriptivo distinto -> caera en revision manual en la app, que es lo seguro.
  return {
    sourceName: `Edwards Tarjeta ****${last4}`,
    sourceType: "credit_card",
    bankName: "Banco Edwards",
    creditCardName: `Edwards ****${last4} (revisar)`,
    accountId: null,
    workspace: "family",
    paymentMethod: "credit_card",
  };
}

const SANTANDER_CHECKING: SourceIdentity = {
  sourceName: "Santander Cuenta Corriente 0-000-7387399-1",
  sourceType: "bank_account",
  bankName: "Banco Santander",
  creditCardName: null,
  accountId: "asIrUoWJkN1jH2zzJhT0", // cuenta "Cuenta Corriente OM" en la app
  workspace: "business",
  paymentMethod: "bank_account",
};

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
    ...edwardsCardIdentity(card),
    date,
    description: merchant,
    amount,
    direction: "expense",
    category: "Sin categoría",
    movementType: "expense",
    createdAt: NOW,
  };
}

/** Santander "Aviso de Transferencia de Fondos" (mensajeria@santander.cl). */
export function parseSantanderTransfer(raw: string): SeedNoBatch | null {
  const text = String(raw).replace(/\s+/g, " ");
  // La direccion la define el TITULAR del correo (primera mencion): "<NOMBRE>, ha recibido/realizado
  // una transferencia". Ojo: los correos de transferencia RECIBIDA tambien contienen "ha realizado"
  // mas abajo en el cuerpo, asi que no basta con .test() — hay que tomar la primera ocurrencia.
  const verbM = text.match(/ha (recibido|realizado) una transferencia/i);
  if (!verbM) return null;
  const isIn = /recibido/i.test(verbM[1]);
  const isOut = !isIn;
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
    ...SANTANDER_CHECKING,
    date,
    description: desc,
    amount,
    direction: isIn ? "income" : "expense",
    category: "Sin categoría",
    movementType: isIn ? "income" : "expense",
    createdAt: NOW,
  };
}

/** Santander "Comprobante de Pago" (bdp@santander.cl): pago de servicios / impuestos.
 *  Ej: "...El pago se ha realizado con exito ... Monto:$527.392 ... Servicio: Pago a S.I.I. ... Fecha: 21-06-2026" */
export function parseSantanderPayment(raw: string): SeedNoBatch | null {
  const text = String(raw).replace(/\s+/g, " ");
  if (!/El pago se ha realizado con [eé]xito/i.test(text)) return null;
  const amountM = text.match(/Monto:\s*\$?\s*([\d.]+)/i);
  const dateM = text.match(/Fecha:\s*(\d{2})-(\d{2})-(\d{4})/i);
  if (!amountM || !dateM) return null;
  const amount = clp(amountM[1]);
  const date = `${dateM[3]}-${dateM[2]}-${dateM[1]}`;
  if (amount <= 0) return null;
  const servM = text.match(/Servicio:\s*(.+?)\s+(?:Cuenta|Rut|RUT|Fecha|Empresa|Hora|Estado|NOR)\b/i);
  const servicio = servM ? servM[1].trim() : "Pago de servicio";
  const desc = /^pago\b/i.test(servicio) ? servicio : `Pago ${servicio}`;
  return {
    source: "email",
    ...SANTANDER_CHECKING,
    date,
    description: desc,
    amount,
    direction: "expense",
    category: "Sin categoría",
    movementType: "expense",
    createdAt: NOW,
  };
}

// ----------------------------- test con la muestra real -----------------------------
const SAMPLE_SAN_OUT = `Aviso de Transferencia de Fondos FRANCISCO ESTEBAN BRICEÑO AGUAYO, ha realizado una transferencia Estimado: FRANCISCO ESTEBAN BRICEÑO AGUAYO Origen Tipo de cuenta Cuenta Nº Cuenta Corriente 0-000-7387399-1 RUT Razon Social 76.901.502-7 AGENCIA OCTOPUS SPA Destino Banco Tipo de cuenta SCOTIABANK AZUL Cuenta Corriente Cuenta Nº RUT 000-000009-9331633-4 78.318.778-7 Nombre Da Ponte Pulgar Spa Mensaje Monto de transferencia 16-06-2026 $ 66.000`;
const SAMPLE_SAN_IN = `Aviso de Transferencia de Fondos Francisco Briceño, ha recibido una transferencia Estimado: Francisco Briceño De acuerdo con lo instruido por nuestro cliente AGENCIA OCTOPUS SPA Detalle de la operación Rut cuenta origen Titular cuenta origen 76.901.502-7 AGENCIA OCTOPUS SPA Banco de Origen Numero de la operacion Santander 20260616130470189139 Monto transferido 16-06-2026 $ 3.000.000`;

const SAMPLE_SAN_PAY = `Office Banking Comprobante de Autorización de Pago El pago se ha realizado con éxito Estimado (a): AGENCIA OCTOPUS SPA / Transaccional Enviamos el detalle del pago realizado. Monto:$527.392 Empresa: AGENCIA OCTOPUS SPA Rut: 76.901.502-7 Servicio: Pago a S.I.I. Cuenta: 0-000-73-87399-1 Fecha: 21-06-2026 Hora Transacción: 20:50 Hrs Estado: Pago Realizado NOR: 000000413717758`;

const SAMPLE_EDWARDS = `Francisco Esteban Briceno Aguayo:
Te informamos que se ha realizado una compra por $320.000 con Tarjeta de
Crédito ****7232 en MP *DECATHLON el 24/06/2026 22:18.
Revisa Saldos y Movimientos en App Mi Banco o Banco en Línea.`;

if (process.argv[1] && process.argv[1].endsWith("parse-email.ts")) {
  console.log("Edwards compra:", JSON.stringify(parseEdwardsCardPurchase(SAMPLE_EDWARDS)));
  console.log("Santander salida:", JSON.stringify(parseSantanderTransfer(SAMPLE_SAN_OUT)));
  console.log("Santander entrada:", JSON.stringify(parseSantanderTransfer(SAMPLE_SAN_IN)));
  console.log("Santander pago:", JSON.stringify(parseSantanderPayment(SAMPLE_SAN_PAY)));
}
