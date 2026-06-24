import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  FileDown,
  Filter,
  ShieldCheck,
  Tags,
  WalletCards,
  Wrench,
} from "lucide-react";
import {
  auditFinanceData,
  summarizeIssuesByArea,
  type AuditIssue,
  type AuditSeverity,
} from "@/domain/finance-audit";
import {
  useAccounts,
  useBudgets,
  useCategories,
  useClientPayments,
  useClients,
  useCommitmentInstances,
  useCommitmentTemplates,
  useCreditCardSettings,
  useImportedMovements,
  useItems,
  useMergeDuplicateCategories,
  useMovementRules,
  useOpeningBalances,
  useRepairBrokenReferences,
  useTransactions,
} from "@/lib/hooks";
import type { Budget, Category, Item, Transaction } from "@shared/schema";
import {
  buildBrokenReferencesPlan,
  buildMergeDuplicateCategoriesPlan,
  normalizeRepairText,
  type RepairOperation,
  type RepairPlan,
} from "@/domain/repair-plans";
import { queryClient } from "@/lib/queryClient";
import { formatCLP } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SeverityFilter = "all" | AuditSeverity;
type IssueTarget = {
  href: string;
  label: string;
};
type DuplicateCategoryGroup = {
  key: string;
  primary: Category;
  duplicates: Category[];
  all: Category[];
  affectedItems: number;
  affectedTransactions: number;
  affectedBudgets: number;
};

const REVIEWED_STORAGE_KEY = "octopus_data_health_reviewed_issues";

const SEVERITY_LABELS: Record<AuditSeverity, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Medio",
  low: "Bajo",
};

const SEVERITY_BADGE: Record<AuditSeverity, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  medium: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-300",
  low: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300",
};

const AREA_LABELS: Record<string, string> = {
  "data-integrity": "Integridad",
  reconciliation: "Conciliación",
};

function areaLabel(area: string) {
  return AREA_LABELS[area] ?? area;
}

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function normalizeText(value: unknown) {
  return normalizeRepairText(value);
}

function getCategoryMergeKey(category: Category) {
  return `${normalizeText(category.name)}::${category.type}::${category.workspace ?? "business"}`;
}

function getCategoryUsageScore(category: Category, items: Item[]) {
  return items.filter((item) => item.categoryId === category.id).length;
}

function getSafeTestId(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function downloadJsonFile(filename: string, payload: unknown) {
  if (typeof window === "undefined") return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function buildDuplicateCategoryGroups(
  categories: Category[],
  items: Item[],
  transactions: Transaction[],
  budgets: Budget[],
): DuplicateCategoryGroup[] {
  const grouped = new Map<string, Category[]>();

  for (const category of categories) {
    const key = getCategoryMergeKey(category);
    grouped.set(key, [...(grouped.get(key) ?? []), category]);
  }

  return Array.from(grouped.entries())
    .filter(([, records]) => records.length > 1)
    .map(([key, records]) => {
      const sorted = [...records].sort((left, right) => {
        const usageDelta = getCategoryUsageScore(right, items) - getCategoryUsageScore(left, items);
        if (usageDelta !== 0) return usageDelta;
        const nameDelta = left.name.localeCompare(right.name, "es");
        if (nameDelta !== 0) return nameDelta;
        return left.id.localeCompare(right.id);
      });
      const primary = sorted[0];
      const duplicates = sorted.slice(1);
      const duplicateIds = new Set(duplicates.map((category) => category.id));
      const duplicateNames = new Set(duplicates.map((category) => normalizeText(category.name)));

      return {
        key,
        primary,
        duplicates,
        all: sorted,
        affectedItems: items.filter((item) => item.categoryId && duplicateIds.has(item.categoryId)).length,
        affectedTransactions: transactions.filter(
          (transaction) =>
            duplicateNames.has(normalizeText(transaction.category)) && transaction.category !== primary.name,
        ).length,
        affectedBudgets: budgets.filter(
          (budget) =>
            !budget.categoryGroup.startsWith("item:") &&
            duplicateNames.has(normalizeText(budget.categoryGroup)) &&
            budget.categoryGroup !== primary.name,
        ).length,
      };
    })
    .sort((left, right) => {
      const duplicateDelta = right.duplicates.length - left.duplicates.length;
      if (duplicateDelta !== 0) return duplicateDelta;
      return left.primary.name.localeCompare(right.primary.name, "es");
    });
}

function getStoredReviewedIssueIds() {
  if (typeof window === "undefined") return new Set<string>();

  try {
    const parsed = JSON.parse(window.localStorage.getItem(REVIEWED_STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function countBySeverity(issues: AuditIssue[]) {
  return issues.reduce<Record<AuditSeverity, number>>(
    (acc, issue) => {
      acc[issue.severity] += 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
}

function issueMatchesText(issue: AuditIssue, fragments: string[]) {
  const haystack = `${issue.title} ${issue.detail} ${issue.recommendation ?? ""}`.toLowerCase();
  return fragments.some((fragment) => haystack.includes(fragment));
}

function summaryNumber(plan: RepairPlan | null | undefined, key: string) {
  const value = plan?.summary[key];
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

function formatRepairValue(value: unknown) {
  if (value === null) return "null";
  if (value === undefined) return "vacío";
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value || "vacío";
  return JSON.stringify(value);
}

function getOperationFields(operation: RepairOperation) {
  if (operation.patch) return Object.keys(operation.patch).filter((field) => field !== "updatedAt");
  const source = operation.after ?? operation.before ?? {};
  return Object.keys(source).filter((field) => field !== "id").slice(0, 4);
}

function getOperationBadge(operation: RepairOperation) {
  if (operation.op === "create") return "Crear";
  if (operation.op === "delete") return "Eliminar";
  return "Actualizar";
}

function getCreatedCategoryNames(plan: RepairPlan) {
  return plan.operations
    .filter((operation) => operation.collection === "categories" && operation.op === "create")
    .map((operation) => String(operation.after?.name ?? ""))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "es"));
}

function renderRepairPlanPreview(plan: RepairPlan | null) {
  if (!plan) return null;
  const visibleOperations = plan.operations.slice(0, 12);
  const hiddenCount = Math.max(0, plan.operations.length - visibleOperations.length);

  if (plan.operations.length === 0) {
    return (
      <div className="rounded-xl border border-[#cdfa46]/10 bg-background/30 px-3 py-4 text-sm text-muted-foreground">
        No hay operaciones para aplicar.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {visibleOperations.map((operation) => {
          const fields = getOperationFields(operation);
          return (
            <div key={operation.id} className="rounded-xl border border-[#cdfa46]/10 bg-background/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{operation.title}</p>
                  <p className="mt-1 truncate text-xs font-mono text-muted-foreground">
                    {operation.collection}/{operation.recordId}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {getOperationBadge(operation)}
                </Badge>
              </div>
              {fields.length > 0 ? (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {fields.slice(0, 4).map((field) => (
                    <p key={field} className="break-words">
                      <span className="font-medium text-foreground">{field}</span>:{" "}
                      {operation.op === "create"
                        ? formatRepairValue(operation.after?.[field])
                        : operation.op === "delete"
                          ? formatRepairValue(operation.before?.[field])
                          : `${formatRepairValue(operation.before?.[field])} -> ${formatRepairValue(operation.after?.[field])}`}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {hiddenCount} {pluralize(hiddenCount, "operación adicional", "operaciones adicionales")} incluidas en el respaldo.
        </p>
      ) : null}
    </div>
  );
}

export default function DataHealthPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [hideReviewed, setHideReviewed] = useState(false);
  const [reviewedIssueIds, setReviewedIssueIds] = useState<Set<string>>(() => getStoredReviewedIssueIds());
  const [pendingMergeGroup, setPendingMergeGroup] = useState<DuplicateCategoryGroup | null>(null);
  const [mergeBackupDownloaded, setMergeBackupDownloaded] = useState(false);
  const [repairDialogOpen, setRepairDialogOpen] = useState(false);
  const [repairBackupDownloaded, setRepairBackupDownloaded] = useState(false);

  const { data: transactions = [], isLoading: transactionsLoading } = useTransactions();
  const { data: categories = [], isLoading: categoriesLoading } = useCategories();
  const { data: items = [], isLoading: itemsLoading } = useItems();
  const { data: budgets = [], isLoading: budgetsLoading } = useBudgets();
  const { data: clientPayments = [], isLoading: clientPaymentsLoading } = useClientPayments();
  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: creditCardSettings = [], isLoading: creditCardSettingsLoading } = useCreditCardSettings();
  const { data: openingBalances = [], isLoading: openingBalancesLoading } = useOpeningBalances();
  const { data: commitmentTemplates = [], isLoading: commitmentTemplatesLoading } = useCommitmentTemplates();
  const { data: commitmentInstances = [], isLoading: commitmentInstancesLoading } = useCommitmentInstances();
  const { data: movementRules = [], isLoading: movementRulesLoading } = useMovementRules();
  const { data: importedMovements = [], isLoading: importedMovementsLoading } = useImportedMovements({ limitCount: 1500 });
  const mergeDuplicateCategoriesMutation = useMergeDuplicateCategories();
  const repairBrokenReferencesMutation = useRepairBrokenReferences();

  const isLoading =
    transactionsLoading ||
    categoriesLoading ||
    itemsLoading ||
    budgetsLoading ||
    clientPaymentsLoading ||
    clientsLoading ||
    accountsLoading ||
    creditCardSettingsLoading ||
    openingBalancesLoading ||
    commitmentTemplatesLoading ||
    commitmentInstancesLoading ||
    movementRulesLoading ||
    importedMovementsLoading;

  const audit = useMemo(
    () =>
      auditFinanceData({
        transactions,
        categories,
        items,
        budgets,
        clientPayments,
        clients,
        accounts,
        creditCardSettings,
        openingBalances,
      }),
    [
      accounts,
      budgets,
      categories,
      clientPayments,
      clients,
      creditCardSettings,
      items,
      openingBalances,
      transactions,
    ],
  );

  const severityCounts = useMemo(() => countBySeverity(audit.issues), [audit.issues]);
  const areaCounts = useMemo(() => summarizeIssuesByArea(audit.issues), [audit.issues]);
  const areaOptions = useMemo(
    () => Object.keys(areaCounts).sort((left, right) => areaLabel(left).localeCompare(areaLabel(right), "es")),
    [areaCounts],
  );
  const issueTargets = useMemo(() => {
    const targets = new Map<string, IssueTarget>();

    transactions.forEach((record) => targets.set(record.id, { href: "/movements", label: "Movimientos" }));
    categories.forEach((record) => targets.set(record.id, { href: "/categories", label: "Categorías" }));
    items.forEach((record) => targets.set(record.id, { href: "/items", label: "Items" }));
    budgets.forEach((record) => targets.set(record.id, { href: "/budget", label: "Presupuesto" }));
    clientPayments.forEach((record) => targets.set(record.id, { href: "/client-payments", label: "Ingresos" }));
    clients.forEach((record) => targets.set(record.id, { href: "/client-payments", label: "Clientes" }));
    accounts.forEach((record) => targets.set(record.id, { href: "/accounts", label: "Cuentas" }));
    creditCardSettings.forEach((record) => targets.set(record.id, { href: "/credit-cards", label: "Tarjetas" }));
    openingBalances.forEach((record) => targets.set(record.id, { href: "/settings", label: "Configuración" }));

    return targets;
  }, [
    accounts,
    budgets,
    categories,
    clientPayments,
    clients,
    creditCardSettings,
    items,
    openingBalances,
    transactions,
  ]);
  const filteredIssues = useMemo(
    () =>
      audit.issues.filter((issue) => {
        const normalizedSearch = searchTerm.trim().toLowerCase();
        if (hideReviewed && reviewedIssueIds.has(issue.id)) return false;
        if (severityFilter !== "all" && issue.severity !== severityFilter) return false;
        if (areaFilter !== "all" && issue.area !== areaFilter) return false;
        if (
          normalizedSearch &&
          !`${issue.title} ${issue.detail} ${issue.recommendation ?? ""} ${issue.recordId ?? ""}`
            .toLowerCase()
            .includes(normalizedSearch)
        ) {
          return false;
        }
        return true;
      }),
    [areaFilter, audit.issues, hideReviewed, reviewedIssueIds, searchTerm, severityFilter],
  );
  const duplicateCategoryGroups = useMemo(
    () => buildDuplicateCategoryGroups(categories, items, transactions, budgets),
    [budgets, categories, items, transactions],
  );
  const repairPlanData = useMemo(
    () => ({
      categories,
      items,
      transactions,
      budgets,
      commitmentTemplates,
      commitmentInstances,
      movementRules,
      importedMovements,
    }),
    [
      budgets,
      categories,
      commitmentInstances,
      commitmentTemplates,
      importedMovements,
      items,
      movementRules,
      transactions,
    ],
  );
  const brokenReferenceRepairPlan = useMemo(
    () => buildBrokenReferencesPlan(repairPlanData),
    [repairPlanData],
  );
  const pendingMergePlan = useMemo(
    () =>
      pendingMergeGroup
        ? buildMergeDuplicateCategoriesPlan(
            repairPlanData,
            pendingMergeGroup.primary.id,
            pendingMergeGroup.duplicates.map((category) => category.id),
          )
        : null,
    [pendingMergeGroup, repairPlanData],
  );
  const repairCreatedCategoryNames = useMemo(
    () => getCreatedCategoryNames(brokenReferenceRepairPlan),
    [brokenReferenceRepairPlan],
  );

  const highPriorityCount = severityCounts.critical + severityCounts.high;
  const duplicateCount = audit.issues.filter((issue) => issueMatchesText(issue, ["duplicad"])).length;
  const orphanCount = audit.issues.filter((issue) =>
    issueMatchesText(issue, ["inexistente", "sin categoria valida", "no existe en catalogo"]),
  ).length;
  const reconciliationCount = audit.issues.filter((issue) => issue.area === "reconciliation").length;
  const reviewedCount = audit.issues.filter((issue) => reviewedIssueIds.has(issue.id)).length;

  const refreshAuditData = () => {
    const queryKeys = [
      ["transactions"],
      ["categories"],
      ["items"],
      ["budgets"],
      ["client-payments"],
      ["clients"],
      ["accounts"],
      ["credit-card-settings"],
      ["opening-balances"],
      ["commitment-templates"],
      ["commitment-instances"],
      ["movement-rules"],
      ["imported-movements"],
    ];
    queryKeys.forEach((queryKey) => {
      queryClient.invalidateQueries({ queryKey });
    });
  };

  const exportAudit = () => {
    downloadJsonFile(`octopus-salud-datos-${audit.generatedAt.slice(0, 10)}.json`, audit);
  };

  const buildDataSnapshot = (action: string) => ({
    generatedAt: new Date().toISOString(),
    schemaVersion: "octopus-finance-data-health-v1",
    action,
    collections: {
      transactions,
      categories,
      items,
      budgets,
      clientPayments,
      clients,
      accounts,
      creditCardSettings,
      openingBalances,
      commitmentTemplates,
      commitmentInstances,
      movementRules,
      importedMovements,
    },
  });

  const exportDataSnapshot = () => {
    downloadJsonFile(
      `octopus-snapshot-datos-${new Date().toISOString().slice(0, 10)}.json`,
      buildDataSnapshot("manual-data-snapshot"),
    );
  };

  const downloadMergeBackup = () => {
    if (!pendingMergePlan) return;

    downloadJsonFile(`octopus-respaldo-fusion-categorias-${new Date().toISOString().slice(0, 10)}.json`, {
      generatedAt: new Date().toISOString(),
      action: "merge-duplicate-categories",
      fullSnapshot: buildDataSnapshot("pre-merge-duplicate-categories"),
      plan: pendingMergePlan,
    });
    setMergeBackupDownloaded(true);
  };

  const downloadRepairBackup = () => {
    downloadJsonFile(`octopus-respaldo-reparacion-referencias-${new Date().toISOString().slice(0, 10)}.json`, {
      generatedAt: new Date().toISOString(),
      action: "repair-broken-references",
      fullSnapshot: buildDataSnapshot("pre-repair-broken-references"),
      plan: brokenReferenceRepairPlan,
    });
    setRepairBackupDownloaded(true);
  };

  const copyRecordId = async (issue: AuditIssue) => {
    if (!issue.recordId) return;

    try {
      await navigator.clipboard.writeText(issue.recordId);
      toast({ title: "ID copiado", description: issue.recordId });
    } catch {
      toast({
        title: "No se pudo copiar",
        description: "Copia el ID manualmente desde la tabla.",
        variant: "destructive",
      });
    }
  };

  const openIssueTarget = async (issue: AuditIssue) => {
    const target = issue.recordId ? issueTargets.get(issue.recordId) : null;

    if (!target) {
      await copyRecordId(issue);
      toast({
        title: "Sin pantalla directa",
        description: "Copié el ID para que puedas buscarlo manualmente.",
      });
      return;
    }

    navigate(target.href);
  };

  const toggleIssueReviewed = (issue: AuditIssue) => {
    setReviewedIssueIds((current) => {
      const next = new Set(current);
      if (next.has(issue.id)) {
        next.delete(issue.id);
      } else {
        next.add(issue.id);
      }

      if (typeof window !== "undefined") {
        window.localStorage.setItem(REVIEWED_STORAGE_KEY, JSON.stringify(Array.from(next)));
      }

      return next;
    });
  };

  const openMergeDialog = (group: DuplicateCategoryGroup) => {
    setMergeBackupDownloaded(false);
    setPendingMergeGroup(group);
  };

  const openRepairDialog = () => {
    setRepairBackupDownloaded(false);
    setRepairDialogOpen(true);
  };

  const confirmMergeCategories = async () => {
    if (!pendingMergeGroup) return;
    if (!mergeBackupDownloaded) {
      toast({
        title: "Descarga el respaldo primero",
        description: "La fusión queda bloqueada hasta respaldar los registros afectados.",
      });
      return;
    }

    try {
      const result = await mergeDuplicateCategoriesMutation.mutateAsync({
        primaryCategoryId: pendingMergeGroup.primary.id,
        duplicateCategoryIds: pendingMergeGroup.duplicates.map((category) => category.id),
      });
      setPendingMergeGroup(null);
      toast({
        title: "Categorías fusionadas",
        description: `${String(result.primaryCategoryName ?? pendingMergeGroup.primary.name)} conserva el historial. ${Number(result.categoriesDeleted ?? 0)} duplicadas eliminadas.`,
      });
    } catch (error) {
      toast({
        title: "No se pudo fusionar",
        description: error instanceof Error ? error.message : "Intenta re-auditar y volver a probar.",
        variant: "destructive",
      });
    }
  };

  const confirmRepairBrokenReferences = async () => {
    if (!repairBackupDownloaded) {
      toast({
        title: "Descarga el respaldo primero",
        description: "La reparación queda bloqueada hasta respaldar los registros afectados.",
      });
      return;
    }

    try {
      const result = await repairBrokenReferencesMutation.mutateAsync();
      setRepairDialogOpen(false);
      setReviewedIssueIds(new Set());
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(REVIEWED_STORAGE_KEY);
      }
      toast({
        title: "Referencias reparadas",
        description: `${Number(result.categoriesCreated ?? 0)} categorias creadas, ${Number(result.itemsReassigned ?? 0)} items reasignados, ${Number(result.transactionsUpdated ?? 0)} movimientos y ${Number(result.budgetsUpdated ?? 0)} presupuestos actualizados.`,
      });
    } catch (error) {
      toast({
        title: "No se pudo reparar",
        description: error instanceof Error ? error.message : "Intenta re-auditar y volver a probar.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <Skeleton className="h-28 rounded-2xl" />
          <div className="grid gap-4 md:grid-cols-4">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
          </div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="rounded-3xl border border-[#cdfa46]/10 bg-gradient-to-br from-[#151223] via-[#0d0d12] to-[#0a0a0f] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Database className="size-5 text-primary" />
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-primary/80">Salud de datos</p>
              </div>
              <h2 className="text-3xl font-black tracking-tight text-foreground">Problemas que pueden distorsionar la app</h2>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Revisión viva de categorías, presupuestos, cuentas, movimientos e ingresos para detectar duplicados,
                referencias rotas y diferencias de conciliación antes de tomar decisiones mensuales.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-full border-[#cdfa46]/15 bg-background/40" onClick={refreshAuditData}>
                Re-auditar
              </Button>
              <Button type="button" className="rounded-full" onClick={exportAudit}>
                Exportar JSON
              </Button>
              <Button type="button" variant="outline" className="rounded-full border-[#cdfa46]/15 bg-background/40 gap-2" onClick={exportDataSnapshot}>
                <FileDown className="size-4" />
                Snapshot
              </Button>
              <Badge variant="outline" className="rounded-full border-[#cdfa46]/20 bg-[#cdfa46]/10 px-3 py-1">
                {audit.issues.length} {pluralize(audit.issues.length, "hallazgo", "hallazgos")}
              </Badge>
              <Badge variant="outline" className="rounded-full border-[#cdfa46]/20 bg-[#cdfa46]/10 px-3 py-1">
                {audit.counts.transactions} movimientos
              </Badge>
              <Badge variant="outline" className="rounded-full border-[#cdfa46]/20 bg-[#cdfa46]/10 px-3 py-1">
                {audit.counts.categories} categorías
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border-[#cdfa46]/10 bg-card/90">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Alta prioridad</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums ${highPriorityCount > 0 ? "text-[#e3e3ea]" : "text-lime-600 dark:text-lime-300"}`}>
                    {highPriorityCount}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Críticos y altos</p>
                </div>
                <AlertTriangle className="size-5 text-red-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#cdfa46]/10 bg-card/90">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Duplicados</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{duplicateCount}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Categorías, movimientos o presupuestos</p>
                </div>
                <Tags className="size-5 text-zinc-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#cdfa46]/10 bg-card/90">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Referencias rotas</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{orphanCount}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Datos que apuntan a algo inexistente</p>
                </div>
                <ShieldCheck className="size-5 text-slate-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#cdfa46]/10 bg-card/90">
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Conciliación</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{reconciliationCount}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Caja, cuentas, tarjetas e ingresos</p>
                </div>
                <WalletCards className="size-5 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="border-[#cdfa46]/10 bg-card/90">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Filter className="size-4 text-primary" />
                  Hallazgos priorizados
                </CardTitle>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Buscar hallazgo"
                    className="w-full sm:w-56"
                    data-testid="input-data-health-search"
                  />
                  <Button
                    type="button"
                    variant={hideReviewed ? "secondary" : "outline"}
                    className="w-full sm:w-auto"
                    onClick={() => setHideReviewed((current) => !current)}
                    data-testid="button-hide-reviewed-issues"
                  >
                    {hideReviewed ? "Mostrando pendientes" : "Ocultar revisados"}
                  </Button>
                  <Select value={severityFilter} onValueChange={(value) => setSeverityFilter(value as SeverityFilter)}>
                    <SelectTrigger className="w-full sm:w-44" data-testid="select-data-health-severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las severidades</SelectItem>
                      <SelectItem value="critical">Crítico</SelectItem>
                      <SelectItem value="high">Alto</SelectItem>
                      <SelectItem value="medium">Medio</SelectItem>
                      <SelectItem value="low">Bajo</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={areaFilter} onValueChange={setAreaFilter}>
                    <SelectTrigger className="w-full sm:w-44" data-testid="select-data-health-area">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las áreas</SelectItem>
                      {areaOptions.map((area) => (
                        <SelectItem key={area} value={area}>
                          {areaLabel(area)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-0">
              {filteredIssues.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-5 py-16 text-center">
                  <CheckCircle2 className="size-10 text-lime-500" />
                  <div>
                    <p className="font-semibold">Sin hallazgos para este filtro</p>
                    <p className="mt-1 text-sm text-muted-foreground">La vista actual no tiene problemas pendientes.</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table data-testid="table-data-health-issues">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-5">Severidad</TableHead>
                        <TableHead>Área</TableHead>
                        <TableHead>Hallazgo</TableHead>
                        <TableHead>Recomendación</TableHead>
                        <TableHead>Registro</TableHead>
                        <TableHead className="text-right pr-5">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredIssues.map((issue) => {
                        const target = issue.recordId ? issueTargets.get(issue.recordId) : null;
                        const isReviewed = reviewedIssueIds.has(issue.id);

                        return (
                          <TableRow key={issue.id} className={isReviewed ? "opacity-60" : undefined}>
                            <TableCell className="pl-5">
                              <div className="flex flex-col gap-1">
                                <Badge className={`w-fit text-xs ${SEVERITY_BADGE[issue.severity]}`}>
                                  {SEVERITY_LABELS[issue.severity]}
                                </Badge>
                                {isReviewed ? (
                                  <Badge variant="outline" className="w-fit text-[10px] text-muted-foreground">
                                    Revisado
                                  </Badge>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{areaLabel(issue.area)}</TableCell>
                            <TableCell className="min-w-[320px]">
                              <p className="text-sm font-medium">{issue.title}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{issue.detail}</p>
                            </TableCell>
                            <TableCell className="min-w-[280px] text-xs text-muted-foreground">
                              {issue.recommendation ?? "Revisar y corregir manualmente si corresponde."}
                            </TableCell>
                            <TableCell className="min-w-[180px]">
                              <div className="space-y-1">
                                <p className="max-w-[180px] truncate text-xs font-mono text-muted-foreground">
                                  {issue.recordId ?? "—"}
                                </p>
                                {target ? (
                                  <p className="text-[11px] text-muted-foreground">{target.label}</p>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="pr-5">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1.5"
                                  onClick={() => openIssueTarget(issue)}
                                  disabled={!issue.recordId}
                                  data-testid={`button-open-issue-${issue.id}`}
                                >
                                  <ExternalLink className="size-3.5" />
                                  Abrir
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label="Copiar ID"
                                  onClick={() => copyRecordId(issue)}
                                  disabled={!issue.recordId}
                                  data-testid={`button-copy-issue-${issue.id}`}
                                >
                                  <Copy className="size-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant={isReviewed ? "secondary" : "ghost"}
                                  size="icon"
                                  className="size-8"
                                  aria-label={isReviewed ? "Quitar revisado" : "Marcar revisado"}
                                  onClick={() => toggleIssueReviewed(issue)}
                                  data-testid={`button-review-issue-${issue.id}`}
                                >
                                  <CheckCircle2 className="size-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-[#cdfa46]/10 bg-card/90">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Severidad</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(Object.keys(SEVERITY_LABELS) as AuditSeverity[]).map((severity) => (
                  <button
                    key={severity}
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl border border-[#cdfa46]/10 bg-background/30 px-3 py-2 text-left text-sm transition hover:bg-background/50"
                    onClick={() => setSeverityFilter(severity)}
                  >
                    <span>{SEVERITY_LABELS[severity]}</span>
                    <Badge className={`text-xs ${SEVERITY_BADGE[severity]}`}>{severityCounts[severity]}</Badge>
                  </button>
                ))}
                <Button type="button" variant="outline" className="w-full" onClick={() => setSeverityFilter("all")}>
                  Ver todas
                </Button>
              </CardContent>
            </Card>

            <Card className="border-[#cdfa46]/10 bg-card/90">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Revisión</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Marcados revisados</span>
                  <span className="font-medium tabular-nums">{reviewedCount}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setHideReviewed((current) => !current)}
                >
                  {hideReviewed ? "Mostrar revisados" : "Ocultar revisados"}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-[#cdfa46]/10 bg-card/90" data-testid="card-broken-reference-repair">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Wrench className="size-4 text-slate-500" />
                  Reparaciones disponibles
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Referencias rotas</span>
                  <span className="font-medium tabular-nums">{summaryNumber(brokenReferenceRepairPlan, "total")}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="rounded-lg border border-[#cdfa46]/10 bg-background/30 px-2 py-2">
                    <p className="font-medium text-foreground">{summaryNumber(brokenReferenceRepairPlan, "items.update")}</p>
                    <p>Items</p>
                  </div>
                  <div className="rounded-lg border border-[#cdfa46]/10 bg-background/30 px-2 py-2">
                    <p className="font-medium text-foreground">
                      {summaryNumber(brokenReferenceRepairPlan, "transactions.update")}
                    </p>
                    <p>Movimientos</p>
                  </div>
                  <div className="rounded-lg border border-[#cdfa46]/10 bg-background/30 px-2 py-2">
                    <p className="font-medium text-foreground">
                      {summaryNumber(brokenReferenceRepairPlan, "budgets.update")}
                    </p>
                    <p>Presupuestos</p>
                  </div>
                  <div className="rounded-lg border border-[#cdfa46]/10 bg-background/30 px-2 py-2">
                    <p className="font-medium text-foreground">{summaryNumber(brokenReferenceRepairPlan, "categories.create")}</p>
                    <p>Categorías</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={openRepairDialog}
                  disabled={summaryNumber(brokenReferenceRepairPlan, "total") === 0 || repairBrokenReferencesMutation.isPending}
                  data-testid="button-open-reference-repair"
                >
                  <Wrench className="size-4" />
                  Revisar reparación
                </Button>
              </CardContent>
            </Card>

            <Card className="border-[#cdfa46]/10 bg-card/90" data-testid="card-duplicate-category-merge">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Tags className="size-4 text-zinc-500" />
                  Categorías duplicadas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {duplicateCategoryGroups.length === 0 ? (
                  <div className="rounded-xl border border-[#cdfa46]/10 bg-background/30 px-3 py-4 text-sm text-muted-foreground">
                    No hay grupos de categorías repetidas por nombre, tipo y ámbito.
                  </div>
                ) : (
                  duplicateCategoryGroups.map((group) => (
                    <div
                      key={group.key}
                      className="rounded-xl border border-[#cdfa46]/10 bg-background/30 p-3"
                      data-testid={`duplicate-category-group-${getSafeTestId(group.key)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{group.primary.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {group.primary.type === "income" ? "Ingreso" : "Gasto"} ·{" "}
                            {group.primary.workspace ?? "business"} · {group.all.length} registros
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {group.duplicates.length} dup.
                        </Badge>
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                        <p>Se conserva: {group.primary.id}</p>
                        <p>
                          Afecta {group.affectedItems} {pluralize(group.affectedItems, "subcategoría", "subcategorías")},{" "}
                          {group.affectedTransactions} {pluralize(group.affectedTransactions, "movimiento", "movimientos")} y{" "}
                          {group.affectedBudgets} {pluralize(group.affectedBudgets, "presupuesto", "presupuestos")}.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full"
                        onClick={() => openMergeDialog(group)}
                        disabled={mergeDuplicateCategoriesMutation.isPending}
                        data-testid={`button-merge-category-group-${getSafeTestId(group.key)}`}
                      >
                        Fusionar grupo
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-[#cdfa46]/10 bg-card/90">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Métricas base</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Caja disponible</span>
                  <span className="font-medium tabular-nums">{formatCLP(audit.metrics.availableCash.all)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Deuda tarjeta</span>
                  <span className="font-medium tabular-nums">{formatCLP(audit.metrics.creditCardDebt)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Clientes cobrados</span>
                  <span className="font-medium tabular-nums">{formatCLP(audit.metrics.paidClientNet)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Clientes pendientes</span>
                  <span className="font-medium tabular-nums">{formatCLP(audit.metrics.unpaidClientNet)}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Diferencia cuentas</span>
                  <span className="font-medium tabular-nums">{formatCLP(audit.metrics.accountLedgerDifference)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <AlertDialog
        open={Boolean(pendingMergeGroup)}
        onOpenChange={(open) => {
          if (!open && !mergeDuplicateCategoriesMutation.isPending) {
            setPendingMergeGroup(null);
            setMergeBackupDownloaded(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fusionar categorías duplicadas</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMergeGroup ? (
                <>
                  Se conservará "{pendingMergeGroup.primary.name}" y se eliminarán{" "}
                  {pendingMergeGroup.duplicates.length} registros duplicados. Antes de eliminar, la app moverá{" "}
                  {pendingMergeGroup.affectedItems} {pluralize(pendingMergeGroup.affectedItems, "subcategoría", "subcategorías")}
                  , {pendingMergeGroup.affectedTransactions}{" "}
                  {pluralize(pendingMergeGroup.affectedTransactions, "movimiento", "movimientos")} y{" "}
                  {pendingMergeGroup.affectedBudgets} {pluralize(pendingMergeGroup.affectedBudgets, "presupuesto", "presupuestos")}{" "}
                  hacia la categoría principal.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingMergeGroup ? (
            <div className="space-y-3 rounded-xl border border-[#cdfa46]/10 bg-background/30 p-3 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="font-semibold tabular-nums">{summaryNumber(pendingMergePlan, "items.update") + summaryNumber(pendingMergePlan, "items.delete")}</p>
                  <p className="text-xs text-muted-foreground">Items</p>
                </div>
                <div>
                  <p className="font-semibold tabular-nums">{summaryNumber(pendingMergePlan, "transactions.update")}</p>
                  <p className="text-xs text-muted-foreground">Movimientos</p>
                </div>
                <div>
                  <p className="font-semibold tabular-nums">{summaryNumber(pendingMergePlan, "budgets.update") + summaryNumber(pendingMergePlan, "budgets.delete")}</p>
                  <p className="text-xs text-muted-foreground">Presupuestos</p>
                </div>
              </div>
              {renderRepairPlanPreview(pendingMergePlan)}
              <Button type="button" variant="outline" className="w-full gap-2" onClick={downloadMergeBackup}>
                <FileDown className="size-4" />
                {mergeBackupDownloaded ? "Respaldo descargado" : "Descargar respaldo"}
              </Button>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mergeDuplicateCategoriesMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={mergeDuplicateCategoriesMutation.isPending || !mergeBackupDownloaded}
              onClick={(event) => {
                event.preventDefault();
                void confirmMergeCategories();
              }}
            >
              {mergeDuplicateCategoriesMutation.isPending ? "Fusionando..." : "Fusionar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={repairDialogOpen}
        onOpenChange={(open) => {
          if (!open && !repairBrokenReferencesMutation.isPending) {
            setRepairDialogOpen(false);
            setRepairBackupDownloaded(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reparar referencias rotas</AlertDialogTitle>
            <AlertDialogDescription>
              La app creará categorías faltantes por nombre cuando el dato ya lo trae, reasignará items huérfanos a
              "Sin categoría" y moverá presupuestos que apuntan a items inexistentes a esa misma categoría.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 rounded-xl border border-[#cdfa46]/10 bg-background/30 p-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-lg bg-background/40 px-2 py-2">
                <p className="font-semibold text-foreground tabular-nums">{summaryNumber(brokenReferenceRepairPlan, "items.update")}</p>
                <p className="text-muted-foreground">Items</p>
              </div>
              <div className="rounded-lg bg-background/40 px-2 py-2">
                <p className="font-semibold text-foreground tabular-nums">{summaryNumber(brokenReferenceRepairPlan, "transactions.update")}</p>
                <p className="text-muted-foreground">Movimientos</p>
              </div>
              <div className="rounded-lg bg-background/40 px-2 py-2">
                <p className="font-semibold text-foreground tabular-nums">{summaryNumber(brokenReferenceRepairPlan, "budgets.update")}</p>
                <p className="text-muted-foreground">Presupuestos</p>
              </div>
              <div className="rounded-lg bg-background/40 px-2 py-2">
                <p className="font-semibold text-foreground tabular-nums">{summaryNumber(brokenReferenceRepairPlan, "categories.create")}</p>
                <p className="text-muted-foreground">Categorías</p>
              </div>
              <div className="rounded-lg bg-background/40 px-2 py-2">
                <p className="font-semibold text-foreground tabular-nums">{summaryNumber(brokenReferenceRepairPlan, "total")}</p>
                <p className="text-muted-foreground">Operaciones</p>
              </div>
              <div className="rounded-lg bg-background/40 px-2 py-2">
                <p className="font-semibold text-foreground tabular-nums">{repairCreatedCategoryNames.length}</p>
                <p className="text-muted-foreground">Nombres nuevos</p>
              </div>
            </div>
            {repairCreatedCategoryNames.length > 0 ? (
              <div className="max-h-24 overflow-y-auto rounded-lg bg-background/40 px-2 py-2 text-xs text-muted-foreground">
                {repairCreatedCategoryNames.join(", ")}
              </div>
            ) : null}
            {renderRepairPlanPreview(brokenReferenceRepairPlan)}
            <Button type="button" variant="outline" className="w-full gap-2" onClick={downloadRepairBackup}>
              <FileDown className="size-4" />
              {repairBackupDownloaded ? "Respaldo descargado" : "Descargar respaldo"}
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={repairBrokenReferencesMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                repairBrokenReferencesMutation.isPending ||
                !repairBackupDownloaded ||
                summaryNumber(brokenReferenceRepairPlan, "total") === 0
              }
              onClick={(event) => {
                event.preventDefault();
                void confirmRepairBrokenReferences();
              }}
            >
              {repairBrokenReferencesMutation.isPending ? "Reparando..." : "Reparar referencias"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
