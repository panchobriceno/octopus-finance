import type {
  Account,
  Budget,
  Category,
  Client,
  ClientPayment,
  CommitmentInstance,
  CommitmentTemplate,
  CreditCardSetting,
  ImportBatch,
  ImportedMovement,
  Item,
  MovementRule,
  OpeningBalance,
  Transaction,
} from "@shared/schema";
import {
  getMonthKeyFromDate,
  isExecutedTransaction,
  normalizeTransaction,
} from "@/lib/finance";
import {
  getAccountBalanceBreakdowns,
  getAvailableCashBalance,
} from "@/domain/accounts";
import {
  isRuleItemConsistent,
  resolveRuleCategoryId,
} from "@/domain/movement-rules";

export type AuditSeverity = "critical" | "high" | "medium" | "low";

export type AuditIssue = {
  id: string;
  severity: AuditSeverity;
  area: string;
  title: string;
  detail: string;
  recordId?: string;
  recommendation?: string;
};

export type FinanceAuditInput = {
  transactions: Transaction[];
  categories: Category[];
  items: Item[];
  budgets: Budget[];
  clientPayments: ClientPayment[];
  clients: Client[];
  accounts: Account[];
  creditCardSettings: CreditCardSetting[];
  openingBalances: OpeningBalance[];
  importBatches?: ImportBatch[];
  importedMovements?: ImportedMovement[];
  commitmentTemplates?: CommitmentTemplate[];
  commitmentInstances?: CommitmentInstance[];
  movementRules?: MovementRule[];
};

export type FinanceAuditResult = {
  generatedAt: string;
  counts: Record<string, number>;
  metrics: {
    availableCash: {
      all: number;
      business: number;
      family: number;
      shared: number;
    };
    accountLedgerDifference: number;
    creditCardDebt: number;
    unpaidClientNet: number;
    paidClientNet: number;
  };
  issues: AuditIssue[];
};

const TRANSACTION_STATUSES = new Set(["paid", "pending", "cancelled"]);
const TRANSACTION_SUBTYPES = new Set(["actual", "planned"]);
const TRANSACTION_TYPES = new Set(["income", "expense"]);
const MOVEMENT_TYPES = new Set(["income", "expense", "transfer", "credit_card_payment"]);
const PAYMENT_METHODS = new Set(["cash", "bank_account", "credit_card"]);
const CLIENT_PAYMENT_STATUSES = new Set(["projected", "receivable", "invoiced", "paid", "cancelled"]);
const WORKSPACES = new Set(["business", "family", "dentist", "shared"]);
const SYSTEM_CATEGORIES = new Set([
  "ingresos clientes",
  "iva por pagar",
  "cuota tarjeta",
  "pago tarjeta",
  "pago tarjeta de credito",
  "transferencia",
  "transferencias",
]);

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveAmount(value: unknown) {
  return isFiniteNumber(value) && value > 0;
}

function isIsoDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

function pushIssue(
  issues: AuditIssue[],
  issue: Omit<AuditIssue, "id">,
) {
  issues.push({
    id: `${issue.area}:${issue.recordId ?? issues.length}:${normalizeText(issue.title).replace(/\s+/g, "-")}`,
    ...issue,
  });
}

function budgetGroupToItemId(categoryGroup: string) {
  return categoryGroup.startsWith("item:") ? categoryGroup.slice("item:".length) : null;
}

export function auditFinanceData(input: FinanceAuditInput): FinanceAuditResult {
  const issues: AuditIssue[] = [];
  const accountIds = new Set(input.accounts.map((account) => account.id));
  const categoryNames = new Set(input.categories.map((category) => normalizeText(category.name)));
  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const transactionIds = new Set(input.transactions.map((transaction) => transaction.id));
  const clientIds = new Set(input.clients.map((client) => client.id));
  const transactionsByClientPaymentId = new Map<string, Transaction[]>();
  const importFingerprintCounts = new Map<string, Transaction[]>();
  const budgetItemIds = new Set(
    input.budgets
      .map((budget) => budgetGroupToItemId(budget.categoryGroup))
      .filter((itemId): itemId is string => Boolean(itemId)),
  );
  const expenseTransactionItemIds = new Set(
    input.transactions
      .filter((transaction) => transaction.type === "expense" && transaction.itemId)
      .map((transaction) => transaction.itemId as string),
  );

  for (const category of input.categories) {
    const scopedKey = `${normalizeText(category.name)}::${category.type}::${category.workspace ?? "business"}`;
    const duplicates = input.categories.filter(
      (candidate) =>
        `${normalizeText(candidate.name)}::${candidate.type}::${candidate.workspace ?? "business"}` === scopedKey,
    );
    if (duplicates.length > 1 && duplicates[0]?.id === category.id) {
      pushIssue(issues, {
        severity: "medium",
        area: "data-integrity",
        title: "Categoria duplicada en el mismo ambito",
        detail: `${category.name} aparece ${duplicates.length} veces para tipo ${category.type}.`,
        recordId: category.id,
        recommendation: "Consolidar categorias duplicadas antes de depender de reportes historicos por nombre.",
      });
    }
  }

  for (const item of input.items) {
    const category = item.categoryId ? categoryById.get(item.categoryId) : null;
    if (!item.categoryId || !category) {
      pushIssue(issues, {
        severity: "medium",
        area: "data-integrity",
        title: "Item sin categoria valida",
        detail: `${item.name} no apunta a una categoria existente.`,
        recordId: item.id,
        recommendation: "Reasignar o eliminar el item para que presupuesto e importador no queden huerfanos.",
      });
    } else if (
      category.type !== "expense" &&
      (budgetItemIds.has(item.id) || expenseTransactionItemIds.has(item.id))
    ) {
      pushIssue(issues, {
        severity: "low",
        area: "data-integrity",
        title: "Item de ingreso usado como gasto",
        detail: `${item.name} esta bajo ${category.name}, pero aparece en presupuesto o movimientos de gasto.`,
        recordId: item.id,
        recommendation: "Moverlo a una categoria de gasto si se usara en presupuesto.",
      });
    }
  }

  for (const transaction of input.transactions) {
    const normalized = normalizeTransaction(transaction);
    const importKey = [
      transaction.date,
      normalizeText(transaction.name),
      transaction.type,
      transaction.amount,
      transaction.accountId ?? "",
      transaction.creditCardName ?? "",
    ].join("__");
    importFingerprintCounts.set(importKey, [...(importFingerprintCounts.get(importKey) ?? []), transaction]);

    if (transaction.sourceClientPaymentId) {
      transactionsByClientPaymentId.set(transaction.sourceClientPaymentId, [
        ...(transactionsByClientPaymentId.get(transaction.sourceClientPaymentId) ?? []),
        transaction,
      ]);
    }

    if (!transaction.name?.trim()) {
      pushIssue(issues, {
        severity: "medium",
        area: "data-integrity",
        title: "Transaccion sin nombre",
        detail: "El movimiento no tiene descripcion util para revisar o deduplicar.",
        recordId: transaction.id,
      });
    }

    if (normalized.status !== "cancelled" && !isPositiveAmount(transaction.amount)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Monto de transaccion invalido",
        detail: `Monto recibido: ${String(transaction.amount)}.`,
        recordId: transaction.id,
        recommendation: "Corregir a un numero positivo finito.",
      });
    }

    if (!isIsoDate(transaction.date)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Fecha de transaccion invalida",
        detail: `Fecha recibida: ${String(transaction.date)}.`,
        recordId: transaction.id,
      });
    }

    if (!TRANSACTION_TYPES.has(transaction.type)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Tipo de transaccion invalido",
        detail: `Tipo recibido: ${String(transaction.type)}.`,
        recordId: transaction.id,
      });
    }

    if (!TRANSACTION_STATUSES.has(normalized.status)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Estado de transaccion invalido",
        detail: `Estado recibido: ${String(transaction.status)}.`,
        recordId: transaction.id,
      });
    }

    if (!TRANSACTION_SUBTYPES.has(normalized.subtype)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Subtipo de transaccion invalido",
        detail: `Subtipo recibido: ${String(transaction.subtype)}.`,
        recordId: transaction.id,
      });
    }

    if (!MOVEMENT_TYPES.has(normalized.movementType)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Tipo de movimiento invalido",
        detail: `Movimiento recibido: ${String(transaction.movementType)}.`,
        recordId: transaction.id,
      });
    }

    if (!PAYMENT_METHODS.has(normalized.paymentMethod)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Metodo de pago invalido",
        detail: `Metodo recibido: ${String(transaction.paymentMethod)}.`,
        recordId: transaction.id,
      });
    }

    if (!WORKSPACES.has(normalized.workspace)) {
      pushIssue(issues, {
        severity: "medium",
        area: "data-integrity",
        title: "Workspace invalido",
        detail: `Workspace recibido: ${String(transaction.workspace)}.`,
        recordId: transaction.id,
      });
    }

    if (transaction.accountId && !accountIds.has(transaction.accountId)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Transaccion apunta a cuenta inexistente",
        detail: `accountId=${transaction.accountId}.`,
        recordId: transaction.id,
      });
    }

    if (transaction.destinationAccountId && !accountIds.has(transaction.destinationAccountId)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Transferencia apunta a cuenta destino inexistente",
        detail: `destinationAccountId=${transaction.destinationAccountId}.`,
        recordId: transaction.id,
      });
    }

    if (
      normalized.movementType === "transfer" &&
      normalized.status !== "cancelled" &&
      !transaction.destinationAccountId
    ) {
      pushIssue(issues, {
        severity: "high",
        area: "reconciliation",
        title: "Transferencia sin cuenta destino",
        detail: "La transferencia no puede reconciliarse por cuenta usando IDs.",
        recordId: transaction.id,
        recommendation: "Migrar destinationWorkspace textual a destinationAccountId cuando sea posible.",
      });
    }

    if (
      normalized.movementType === "transfer" &&
      transaction.accountId &&
      transaction.destinationAccountId &&
      transaction.accountId === transaction.destinationAccountId
    ) {
      pushIssue(issues, {
        severity: "high",
        area: "reconciliation",
        title: "Transferencia con misma cuenta origen y destino",
        detail: "El movimiento no cambia saldos y probablemente esta mal ingresado.",
        recordId: transaction.id,
      });
    }

    if (
      normalized.status === "paid" &&
      normalized.paymentMethod === "bank_account" &&
      normalized.movementType !== "transfer" &&
      !transaction.accountId
    ) {
      pushIssue(issues, {
        severity: "medium",
        area: "reconciliation",
        title: "Movimiento bancario pagado sin cuenta",
        detail: "El movimiento afecta caja pero no puede atribuirse a una cuenta.",
        recordId: transaction.id,
        recommendation: "Asignar cuenta origen/destino para reconciliacion.",
      });
    }

    if (
      normalized.paymentMethod === "credit_card" &&
      normalized.movementType === "expense" &&
      !transaction.creditCardName
    ) {
      pushIssue(issues, {
        severity: "high",
        area: "reconciliation",
        title: "Compra TC sin tarjeta",
        detail: "La deuda de tarjeta no puede atribuirse.",
        recordId: transaction.id,
      });
    }

    if (
      normalized.movementType === "credit_card_payment" &&
      !transaction.creditCardName
    ) {
      pushIssue(issues, {
        severity: "high",
        area: "reconciliation",
        title: "Pago TC sin tarjeta",
        detail: "El pago resta caja pero no puede rebajar deuda de una tarjeta concreta.",
        recordId: transaction.id,
      });
    }

    const categoryKey = normalizeText(transaction.category);
    if (
      transaction.category &&
      normalized.status !== "cancelled" &&
      !categoryNames.has(categoryKey) &&
      !SYSTEM_CATEGORIES.has(categoryKey)
    ) {
      pushIssue(issues, {
        severity: "low",
        area: "data-integrity",
        title: "Categoria historica no existe en catalogo",
        detail: `${transaction.category} no aparece como categoria actual.`,
        recordId: transaction.id,
        recommendation: "Mapear a categoryId en una migracion futura para que renombrar no rompa historicos.",
      });
    }

    if (transaction.itemId && !itemById.has(transaction.itemId)) {
      pushIssue(issues, {
        severity: "medium",
        area: "data-integrity",
        title: "Transaccion apunta a item inexistente",
        detail: `itemId=${transaction.itemId}.`,
        recordId: transaction.id,
      });
    }
  }

  for (const [fingerprint, matches] of Array.from(importFingerprintCounts.entries())) {
    if (matches.length <= 1) continue;
    pushIssue(issues, {
      severity: "medium",
      area: "data-integrity",
      title: "Posible transaccion duplicada",
      detail: `${matches.length} movimientos comparten huella ${fingerprint}.`,
      recordId: matches[0]?.id,
      recommendation: "Revisar antes de limpiar; pagos repetidos reales pueden verse iguales.",
    });
  }

  for (const payment of input.clientPayments) {
    const linkedTransactions = transactionsByClientPaymentId.get(payment.id) ?? [];
    const clientExists = payment.clientId ? clientIds.has(payment.clientId) : true;

    if (!CLIENT_PAYMENT_STATUSES.has(payment.status)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Estado de ingreso cliente invalido",
        detail: `Estado recibido: ${String(payment.status)}.`,
        recordId: payment.id,
      });
    }

    if (!clientExists) {
      pushIssue(issues, {
        severity: "medium",
        area: "data-integrity",
        title: "Ingreso cliente apunta a cliente inexistente",
        detail: `clientId=${payment.clientId}.`,
        recordId: payment.id,
      });
    }

    if (!isPositiveAmount(payment.netAmount)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Ingreso cliente con neto invalido",
        detail: `Neto recibido: ${String(payment.netAmount)}.`,
        recordId: payment.id,
      });
    }

    if (Math.abs((payment.netAmount + payment.vatAmount) - payment.totalAmount) > 5) {
      pushIssue(issues, {
        severity: "medium",
        area: "reconciliation",
        title: "Ingreso cliente no cuadra neto + IVA",
        detail: `Neto ${payment.netAmount}, IVA ${payment.vatAmount}, total ${payment.totalAmount}.`,
        recordId: payment.id,
      });
    }

    if (payment.status === "paid" && !payment.paymentDate) {
      pushIssue(issues, {
        severity: "high",
        area: "reconciliation",
        title: "Ingreso pagado sin fecha de pago",
        detail: "El ingreso real no puede asignarse con confianza al mes.",
        recordId: payment.id,
      });
    }

    if (payment.status === "paid" && linkedTransactions.length === 0) {
      pushIssue(issues, {
        severity: "high",
        area: "reconciliation",
        title: "Ingreso pagado sin movimiento de caja",
        detail: "El pago cliente esta marcado pagado, pero no tiene settlement en transactions.",
        recordId: payment.id,
        recommendation: "Correr regularizacion de ingresos cliente con cuenta destino.",
      });
    }

    if (payment.status !== "paid" && linkedTransactions.length > 0) {
      pushIssue(issues, {
        severity: "high",
        area: "reconciliation",
        title: "Ingreso no pagado con movimiento de caja",
        detail: `${linkedTransactions.length} movimiento(s) siguen asociados al pago.`,
        recordId: payment.id,
      });
    }

    if (linkedTransactions.length > 1) {
      pushIssue(issues, {
        severity: "medium",
        area: "data-integrity",
        title: "Ingreso cliente con settlement duplicado",
        detail: `${linkedTransactions.length} transacciones apuntan al mismo pago.`,
        recordId: payment.id,
      });
    }

    const [settlement] = linkedTransactions;
    if (payment.status === "paid" && settlement) {
      if (settlement.amount !== payment.netAmount) {
        pushIssue(issues, {
          severity: "medium",
          area: "reconciliation",
          title: "Settlement cliente no coincide con neto",
          detail: `Movimiento ${settlement.amount}, pago neto ${payment.netAmount}.`,
          recordId: settlement.id,
        });
      }
      if (payment.paymentDate && settlement.date !== payment.paymentDate) {
        pushIssue(issues, {
          severity: "medium",
          area: "reconciliation",
          title: "Settlement cliente con fecha distinta al pago",
          detail: `Movimiento ${settlement.date}, pago ${payment.paymentDate}.`,
          recordId: settlement.id,
        });
      }
    }
  }

  for (const movement of input.importedMovements ?? []) {
    if (
      ["converted", "reconciled"].includes(movement.status) &&
      (!movement.matchedTransactionId || !transactionIds.has(movement.matchedTransactionId))
    ) {
      pushIssue(issues, {
        severity: "high",
        area: "import-pipeline",
        title: "Cartola resuelta apunta a transaccion inexistente",
        detail: `${movement.description} esta ${movement.status}, pero matchedTransactionId=${movement.matchedTransactionId ?? "null"} no existe.`,
        recordId: movement.id,
        recommendation: "Deshacer la conversion/conciliacion o devolver el movimiento a revision.",
      });
    }
  }

  const now = Date.now();
  const STALE_REVIEW_DAYS = 14;
  for (const batch of input.importBatches ?? []) {
    const createdAt = Date.parse(batch.createdAt ?? "");
    const ageDays = Number.isFinite(createdAt) ? Math.floor((now - createdAt) / 86400000) : 0;
    if (["reviewing", "partially_converted"].includes(batch.status) && ageDays > STALE_REVIEW_DAYS) {
      pushIssue(issues, {
        severity: "medium",
        area: "import-pipeline",
        title: "Lote de importacion viejo en revision",
        detail: `${batch.label} lleva ${ageDays} dias sin cerrarse.`,
        recordId: batch.id,
        recommendation: "Cerrar, convertir u omitir el lote para que el cierre mensual no dependa de pendientes antiguos.",
      });
    }
  }

  for (const rule of input.movementRules ?? []) {
    const expectedType = rule.movementType === "income" ? "income" : "expense";
    const categoryId = resolveRuleCategoryId(input.categories, rule.category, rule.movementType, rule.workspace);
    if (!categoryId) {
      pushIssue(issues, {
        severity: "medium",
        area: "import-pipeline",
        title: "Regla apunta a categoria inexistente",
        detail: `${rule.name} usa categoria ${rule.category} (${expectedType}/${rule.workspace ?? "business"}).`,
        recordId: rule.id,
        recommendation: "Editar o desactivar la regla antes de importar nuevas cartolas.",
      });
      continue;
    }
    if (
      !isRuleItemConsistent(
        input.categories,
        input.items,
        rule.category,
        rule.movementType,
        rule.workspace,
        rule.itemId,
      )
    ) {
      pushIssue(issues, {
        severity: "medium",
        area: "import-pipeline",
        title: "Regla apunta a subcategoria incompatible",
        detail: `${rule.name} usa itemId=${rule.itemId}, pero no pertenece a ${rule.category}.`,
        recordId: rule.id,
        recommendation: "Limpiar la subcategoria de la regla o moverla a la categoria correcta.",
      });
    }
  }

  const budgetKeyCounts = new Map<string, Budget[]>();
  for (const budget of input.budgets) {
    const key = `${budget.year}-${budget.month}::${budget.workspace ?? "business"}::${budget.categoryGroup}`;
    budgetKeyCounts.set(key, [...(budgetKeyCounts.get(key) ?? []), budget]);

    const itemId = budgetGroupToItemId(budget.categoryGroup);
    if (itemId) {
      if (!itemById.has(itemId)) {
        pushIssue(issues, {
          severity: "medium",
          area: "data-integrity",
          title: "Presupuesto apunta a item inexistente",
          detail: `categoryGroup=${budget.categoryGroup}.`,
          recordId: budget.id,
        });
      }
    } else if (!categoryNames.has(normalizeText(budget.categoryGroup))) {
      pushIssue(issues, {
        severity: "medium",
        area: "data-integrity",
        title: "Presupuesto apunta a categoria inexistente",
        detail: `categoryGroup=${budget.categoryGroup}.`,
        recordId: budget.id,
      });
    }

    if (!isFiniteNumber(budget.amount) || budget.amount < 0) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Presupuesto con monto invalido",
        detail: `Monto recibido: ${String(budget.amount)}.`,
        recordId: budget.id,
      });
    }
  }

  for (const [key, matches] of Array.from(budgetKeyCounts.entries())) {
    if (matches.length <= 1) continue;
    pushIssue(issues, {
      severity: "medium",
      area: "data-integrity",
      title: "Presupuesto duplicado para mismo periodo",
      detail: `${matches.length} presupuestos comparten ${key}.`,
      recordId: matches[0]?.id,
    });
  }

  for (const openingBalance of input.openingBalances) {
    if (!Number.isInteger(openingBalance.year) || !Number.isInteger(openingBalance.month)) {
      pushIssue(issues, {
        severity: "medium",
        area: "data-integrity",
        title: "Saldo inicial con periodo invalido",
        detail: `year=${openingBalance.year}, month=${openingBalance.month}.`,
        recordId: openingBalance.id,
      });
    }
    if (!isFiniteNumber(openingBalance.amount)) {
      pushIssue(issues, {
        severity: "high",
        area: "data-integrity",
        title: "Saldo inicial con monto invalido",
        detail: `Monto recibido: ${String(openingBalance.amount)}.`,
        recordId: openingBalance.id,
      });
    }
  }

  for (const setting of input.creditCardSettings) {
    if (setting.defaultPaymentAccountId && !accountIds.has(setting.defaultPaymentAccountId)) {
      pushIssue(issues, {
        severity: "medium",
        area: "data-integrity",
        title: "Tarjeta vinculada a cuenta inexistente",
        detail: `${setting.cardName} usa accountId=${setting.defaultPaymentAccountId}.`,
        recordId: setting.id,
      });
    }
  }

  const accountBreakdowns = getAccountBalanceBreakdowns(input.accounts, input.transactions);
  for (const breakdown of accountBreakdowns) {
    if (breakdown.legacyIncomingTransfers > 0) {
      pushIssue(issues, {
        severity: "medium",
        area: "reconciliation",
        title: "Cuenta depende de transferencias legacy por texto",
        detail: `${breakdown.account.name} recibe ${breakdown.legacyIncomingTransfers} por matching textual.`,
        recordId: breakdown.account.id,
        recommendation: "Migrar esas transferencias a destinationAccountId.",
      });
    }
  }

  const creditCardDebt = input.transactions.reduce((sum, transaction) => {
    const normalized = normalizeTransaction(transaction);
    if (!isExecutedTransaction(normalized)) return sum;
    if (normalized.movementType === "expense" && normalized.paymentMethod === "credit_card") {
      return sum + normalized.amount;
    }
    if (normalized.movementType === "credit_card_payment") {
      return sum - normalized.amount;
    }
    return sum;
  }, 0);

  const paidClientNet = input.clientPayments.reduce(
    (sum, payment) => payment.status === "paid" ? sum + payment.netAmount : sum,
    0,
  );
  const unpaidClientNet = input.clientPayments.reduce(
    (sum, payment) =>
      payment.status !== "paid" && payment.status !== "cancelled" ? sum + payment.netAmount : sum,
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      transactions: input.transactions.length,
      categories: input.categories.length,
      items: input.items.length,
      budgets: input.budgets.length,
      clientPayments: input.clientPayments.length,
      clients: input.clients.length,
      accounts: input.accounts.length,
      creditCardSettings: input.creditCardSettings.length,
      openingBalances: input.openingBalances.length,
      importBatches: input.importBatches?.length ?? 0,
      importedMovements: input.importedMovements?.length ?? 0,
      commitmentTemplates: input.commitmentTemplates?.length ?? 0,
      commitmentInstances: input.commitmentInstances?.length ?? 0,
      movementRules: input.movementRules?.length ?? 0,
    },
    metrics: {
      availableCash: {
        all: getAvailableCashBalance(input.accounts),
        business: getAvailableCashBalance(input.accounts, "business"),
        family: getAvailableCashBalance(input.accounts, "family"),
        shared: getAvailableCashBalance(input.accounts, "shared"),
      },
      accountLedgerDifference: accountBreakdowns.reduce((sum, breakdown) => sum + breakdown.difference, 0),
      creditCardDebt,
      unpaidClientNet,
      paidClientNet,
    },
    issues: issues.sort((left, right) => {
      const severityOrder: Record<AuditSeverity, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      return severityOrder[left.severity] - severityOrder[right.severity] ||
        left.area.localeCompare(right.area) ||
        left.title.localeCompare(right.title);
    }),
  };
}

export function summarizeIssuesByArea(issues: AuditIssue[]) {
  return issues.reduce<Record<string, Record<AuditSeverity, number>>>((acc, issue) => {
    acc[issue.area] ??= { critical: 0, high: 0, medium: 0, low: 0 };
    acc[issue.area][issue.severity] += 1;
    return acc;
  }, {});
}

export function getIssueMonth(issue: AuditIssue, transactions: Transaction[]) {
  const transaction = issue.recordId ? transactions.find((candidate) => candidate.id === issue.recordId) : null;
  return transaction?.date ? getMonthKeyFromDate(transaction.date) : null;
}
