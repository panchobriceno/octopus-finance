/**
 * Resolución de catálogo para reglas de categorización (MovementRule).
 *
 * `MovementRule.category` guarda un NOMBRE, no un id; los items (subcategorías)
 * apuntan a un `categoryId`. Para saber qué subcategorías puede usar una regla
 * hay que resolver el nombre de categoría → id → filtrar items por ese id.
 *
 * El "type" de la categoría se deriva del movimiento: sólo `income` mapea a
 * categorías de ingreso; `expense`, `transfer` y `credit_card_payment` usan el
 * lado de egresos (invariante del producto: las reglas no-ingreso categorizan
 * contra categorías de egreso). Ver test que fija esta regla.
 *
 * Se usa el mismo normalizador (`normalizeImportText`) que el motor de
 * sugerencia (`applyMovementRule`) para que el editor quede alineado con cómo
 * se aplican las reglas al importar.
 */
import type { Category, Item } from "@shared/schema";
import { normalizeImportText } from "./bank-imports";

/** Deriva el tipo de categoría ("income" | "expense") desde el movementType de la regla. */
export function categoryTypeForMovementType(movementType: string | undefined | null): "income" | "expense" {
  return movementType === "income" ? "income" : "expense";
}

/**
 * Resuelve el nombre de categoría de una regla a su id.
 * Prioriza el match por nombre + tipo + workspace; si no hay match con workspace,
 * cae al match por nombre + tipo (mismo criterio que import-data.tsx).
 * Devuelve `null` si el nombre no existe en el catálogo.
 */
export function resolveRuleCategoryId(
  categories: Category[],
  categoryName: string | undefined | null,
  movementType: string | undefined | null,
  workspace: string | undefined | null,
): string | null {
  const name = normalizeImportText(categoryName);
  if (!name) return null;
  const type = categoryTypeForMovementType(movementType);
  const byName = categories.filter(
    (category) => normalizeImportText(category.name) === name && category.type === type,
  );
  if (byName.length === 0) return null;
  const byWorkspace = byName.find(
    (category) => !category.workspace || !workspace || category.workspace === workspace,
  );
  return (byWorkspace ?? byName[0]).id;
}

/** Items (subcategorías) disponibles para la categoría de una regla. */
export function itemsForRuleCategory(
  categories: Category[],
  items: Item[],
  categoryName: string | undefined | null,
  movementType: string | undefined | null,
  workspace: string | undefined | null,
): Item[] {
  const categoryId = resolveRuleCategoryId(categories, categoryName, movementType, workspace);
  if (!categoryId) return [];
  return items.filter((item) => item.categoryId === categoryId);
}

/**
 * ¿El itemId elegido es consistente con la categoría de la regla?
 * `null`/vacío siempre es consistente (una regla puede no fijar subcategoría).
 * En caso contrario, el item debe existir y pertenecer a la categoría resuelta.
 */
export function isRuleItemConsistent(
  categories: Category[],
  items: Item[],
  categoryName: string | undefined | null,
  movementType: string | undefined | null,
  workspace: string | undefined | null,
  itemId: string | undefined | null,
): boolean {
  if (!itemId) return true;
  const categoryId = resolveRuleCategoryId(categories, categoryName, movementType, workspace);
  if (!categoryId) return false;
  return items.some((item) => item.id === itemId && item.categoryId === categoryId);
}

/**
 * Sanea el itemId contra la categoría: devuelve el mismo itemId si es
 * consistente, o `null` si no lo es (o si viene vacío). Se usa al guardar para
 * NO persistir subcategorías huérfanas (que envenenarían la sugerencia del
 * importador) sin bloquear la edición de reglas legacy ya inconsistentes.
 */
export function sanitizeRuleItemId(
  categories: Category[],
  items: Item[],
  categoryName: string | undefined | null,
  movementType: string | undefined | null,
  workspace: string | undefined | null,
  itemId: string | undefined | null,
): string | null {
  if (!itemId) return null;
  return isRuleItemConsistent(categories, items, categoryName, movementType, workspace, itemId)
    ? itemId
    : null;
}

/** Parsea el campo de keywords (texto separado por comas) a un array limpio y deduplicado. */
export function parseRuleKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const key = normalizeImportText(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
