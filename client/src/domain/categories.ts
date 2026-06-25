import type { Category } from "@shared/schema";

/**
 * Regla de visibilidad de categorías por ámbito.
 * Una categoría SIN ámbito (workspace null/vacío) es "compartida": aparece en
 * todos los ámbitos. Una con ámbito explícito solo aparece en ese ámbito.
 * Así el selector filtra por ámbito sin esconder las que sirven en varios.
 * (Misma lógica que ya usaba el presupuesto en matchesWorkspace.)
 */
export function categoryMatchesWorkspace(category: Category, workspace: string | null | undefined) {
  if (!category.workspace) return true; // compartida → visible en todos
  if (!workspace) return true; // sin ámbito de contexto → no filtramos
  return category.workspace === workspace;
}
