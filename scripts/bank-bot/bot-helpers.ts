/**
 * Helpers compartidos por los loaders del bank-bot. En un solo lugar para no driftear.
 */
import type { MovementRule, Transaction } from "../../shared/schema";

export const daysBetween = (a: string, b: string) =>
  Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

/**
 * Reglas aplicables segun la direccion del movimiento. RESPETA amountDirection, que el
 * motor de la app (movementRuleScore) NO chequea. Sin esto, una regla de ingreso (ej.
 * "aguayo" -> Otros Ingresos) matchearia un GASTO que contiene ese texto (tu apellido
 * aparece en transferencias salientes) y applyMovementRule lo voltearia a ingreso.
 */
export function rulesForDirection(rules: MovementRule[], direction: string): MovementRule[] {
  return rules.filter((r) => {
    const d = r.amountDirection;
    return !d || d === "any" || d === direction;
  });
}

/**
 * Duplicado vs una transaccion ya en los libros: mismo monto, misma direccion, fecha
 * cercana. Es laxo a proposito (los cargos no siempre calzan de fecha exacta). Por eso
 * los que matchean NO se descartan en silencio: se cargan marcados "duplicate" para que
 * el humano confirme o fuerce. Asi nunca se pierde un movimiento real.
 */
export function findTxDuplicate(
  txs: Transaction[],
  m: { amount: number; direction: string; date: string },
  windowDays = 5,
): Transaction | undefined {
  return txs.find(
    (t) =>
      Number(t.amount) === m.amount &&
      t.type === m.direction &&
      daysBetween(t.date, m.date) <= windowDays,
  );
}
