import type {
  Budget,
  Category,
  CommitmentInstance,
  CommitmentTemplate,
  ImportedMovement,
  Item,
  MovementRule,
  Transaction,
} from "@shared/schema";
import { categoryTypeForMovementType } from "./movement-rules";

export type DeleteImpactCounts = Record<string, number>;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function countBy<T>(rows: T[], predicate: (row: T) => boolean) {
  return rows.reduce((sum, row) => sum + (predicate(row) ? 1 : 0), 0);
}

function sameWorkspace(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "business") === (right ?? "business");
}

function categoryMatches(
  category: Category,
  candidateName: string | null | undefined,
  candidateType: string | null | undefined,
  candidateWorkspace: string | null | undefined,
) {
  return (
    normalizeText(candidateName) === normalizeText(category.name) &&
    candidateType === category.type &&
    sameWorkspace(candidateWorkspace, category.workspace)
  );
}

export function countCategoryDeleteImpact(input: {
  category: Category;
  items: Item[];
  transactions: Transaction[];
  budgets: Budget[];
  commitmentTemplates: CommitmentTemplate[];
  commitmentInstances: CommitmentInstance[];
  movementRules: MovementRule[];
  importedMovements: ImportedMovement[];
}): DeleteImpactCounts {
  const categoryName = normalizeText(input.category.name);
  return {
    items: countBy(input.items, (item) => item.categoryId === input.category.id),
    transactions: countBy(input.transactions, (tx) =>
      categoryMatches(input.category, tx.category, tx.type, tx.workspace),
    ),
    budgets: countBy(input.budgets, (budget) =>
      !budget.categoryGroup.startsWith("item:") &&
      normalizeText(budget.categoryGroup) === categoryName &&
      input.category.type === "expense" &&
      sameWorkspace(budget.workspace, input.category.workspace),
    ),
    commitmentTemplates: countBy(input.commitmentTemplates, (template) =>
      categoryMatches(
        input.category,
        template.category,
        categoryTypeForMovementType(template.movementType),
        template.workspace,
      ),
    ),
    commitmentInstances: countBy(input.commitmentInstances, (instance) =>
      categoryMatches(
        input.category,
        instance.category,
        categoryTypeForMovementType(instance.movementType),
        instance.workspace,
      ),
    ),
    movementRules: countBy(input.movementRules, (rule) =>
      categoryMatches(
        input.category,
        rule.category,
        categoryTypeForMovementType(rule.movementType),
        rule.workspace,
      ),
    ),
    importedMovements: countBy(input.importedMovements, (movement) =>
      categoryMatches(
        input.category,
        movement.suggestedCategory,
        categoryTypeForMovementType(movement.suggestedMovementType),
        movement.suggestedWorkspace,
      ),
    ),
  };
}

export function countItemDeleteImpact(input: {
  item: Item;
  transactions: Transaction[];
  budgets: Budget[];
  commitmentTemplates: CommitmentTemplate[];
  commitmentInstances: CommitmentInstance[];
  movementRules: MovementRule[];
  importedMovements: ImportedMovement[];
}): DeleteImpactCounts {
  const itemBudgetKey = `item:${input.item.id}`;
  const sourceBudgetKeySuffix = `::${itemBudgetKey}`;
  const sourceTemplateIds = new Set(
    input.commitmentTemplates
      .filter((template) => template.sourceBudgetKey?.endsWith(sourceBudgetKeySuffix))
      .map((template) => template.id),
  );
  return {
    transactions: countBy(input.transactions, (tx) => tx.itemId === input.item.id),
    budgets: countBy(input.budgets, (budget) => budget.categoryGroup === itemBudgetKey),
    commitmentTemplates: sourceTemplateIds.size,
    commitmentInstances: countBy(input.commitmentInstances, (instance) => sourceTemplateIds.has(instance.templateId)),
    movementRules: countBy(input.movementRules, (rule) => rule.itemId === input.item.id),
    importedMovements: countBy(input.importedMovements, (movement) => movement.suggestedItemId === input.item.id),
  };
}

export function sumDeleteImpact(counts: DeleteImpactCounts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}
