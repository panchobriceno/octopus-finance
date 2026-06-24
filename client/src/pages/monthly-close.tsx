import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, LockKeyhole, RotateCcw } from "lucide-react";
import { Link } from "wouter";
import { AmountText } from "@/components/finance/amount-text";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCLP } from "@/lib/utils";
import {
  useBudgets,
  useCategories,
  useClientPayments,
  useImportBatches,
  useMonthlyCloseSnapshots,
  useReopenMonthlyCloseSnapshot,
  useSaveMonthlyCloseSnapshot,
  useTransactions,
} from "@/lib/hooks";
import { getTransactionExpenseImpact, isExecutedTransaction, normalizeTransaction, summarizeClientPaymentsByMonth } from "@/lib/finance";
import { getFamilyIncomeJaviMap } from "@/lib/family-income";
import { useToast } from "@/hooks/use-toast";
import type { Budget, Category, MonthlyCloseChecklistItem, MonthlyCloseSummaryRow } from "@shared/schema";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type CloseWorkspace = "business" | "family";
type ChecklistStatus = MonthlyCloseChecklistItem["status"];

function normalizeCategoryName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchesWorkspace(category: Category, workspace: CloseWorkspace) {
  if (category.workspace) {
    return category.workspace === workspace;
  }

  const normalizedName = normalizeCategoryName(category.name);
  const fallbackFamilyNames = [
    "dividendo",
    "gastos comunes",
    "gastos basicos",
    "auto",
    "comida",
    "tarjeta de credito",
    "farmacia",
    "seguros",
    "educacion",
    "salud",
    "digital",
    "ocio",
  ];
  const isFamilyCategory = fallbackFamilyNames.some((name) => normalizedName.includes(name));
  return workspace === "family" ? isFamilyCategory : !isFamilyCategory;
}

function getEffectiveBudgetTotalForWorkspace(
  workspace: CloseWorkspace,
  categories: Category[],
  budgets: Budget[],
  year: number,
  month: number,
) {
  const names = categories
    .filter((category) => category.type === "expense" && matchesWorkspace(category, workspace))
    .map((category) => category.name);

  return names.reduce((sum, group) => {
    const exact = budgets.find(
      (budget) =>
        budget.categoryGroup === group &&
        (budget.workspace ?? "business") === workspace &&
        budget.year === year &&
        budget.month === month,
    );

    if (exact?.isArchived) return sum;
    if (exact) return sum + exact.amount;

    const historical = budgets
      .filter(
        (budget) =>
          budget.categoryGroup === group &&
          !budget.isArchived &&
          (budget.workspace ?? "business") === workspace &&
          (budget.year < year || (budget.year === year && budget.month < month)),
      )
      .sort((left, right) => {
        if (left.year !== right.year) return right.year - left.year;
        return right.month - left.month;
      })[0];

    return sum + (historical?.amount ?? 0);
  }, 0);
}

function buildSummaryRow(id: string, label: string, budget: number, actual: number): MonthlyCloseSummaryRow {
  const delta = actual - budget;
  return {
    id,
    label,
    budget,
    actual,
    delta,
    deltaPercent: budget !== 0 ? delta / Math.abs(budget) : null,
  };
}

function getChecklistTone(status: ChecklistStatus) {
  if (status === "ready") return "text-emerald-700 dark:text-emerald-300";
  if (status === "blocked") return "text-red-700 dark:text-red-300";
  return "text-amber-700 dark:text-amber-300";
}

// Cada ítem del checklist enlaza a la pantalla donde se resuelve (rutas existentes).
const CHECKLIST_RESOLVE_ROUTE: Record<string, string> = {
  "pending-transactions": "/movements",
  "uncategorized-transactions": "/data-health",
  "client-payments": "/client-payments",
  "import-batches": "/movements",
  "workspace-categories": "/categories",
  "family-income-source": "/budget",
};

function isUncategorized(value: string | null | undefined) {
  const normalized = normalizeCategoryName(value ?? "");
  return !normalized || normalized === "sin categoria" || normalized === "uncategorized" || normalized === "otros";
}

function clientPaymentBelongsToMonth(payment: { serviceMonth?: string | null; paymentDate?: string | null; expectedDate?: string | null; dueDate?: string | null; issueDate?: string | null }, monthKey: string) {
  return [payment.serviceMonth, payment.paymentDate, payment.expectedDate, payment.dueDate, payment.issueDate]
    .filter(Boolean)
    .some((value) => String(value).startsWith(monthKey));
}

function batchTouchesMonth(batch: { periodStart?: string | null; periodEnd?: string | null; createdAt?: string | null }, monthKey: string) {
  if (batch.periodStart?.startsWith(monthKey) || batch.periodEnd?.startsWith(monthKey)) return true;
  if (!batch.periodStart && !batch.periodEnd && batch.createdAt?.startsWith(monthKey)) return true;
  if (!batch.periodStart || !batch.periodEnd) return false;
  return batch.periodStart <= `${monthKey}-31` && batch.periodEnd >= `${monthKey}-01`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sin fecha";
  return value.slice(0, 16).replace("T", " ");
}

export default function MonthlyClosePage() {
  const currentPeriod = useMemo(() => {
    const current = new Date();
    return {
      month: current.getMonth() + 1,
      year: current.getFullYear(),
    };
  }, []);
  const [selectedYear, setSelectedYear] = useState(currentPeriod.year);
  const [selectedMonth, setSelectedMonth] = useState(currentPeriod.month);
  const [familyIncomeJaviMap, setFamilyIncomeJaviMap] = useState<Record<string, number>>({});
  const [closeNotes, setCloseNotes] = useState("");

  const { data: transactions = [], isLoading: txLoading } = useTransactions();
  const { data: clientPayments = [], isLoading: clientLoading } = useClientPayments();
  const { data: budgets = [], isLoading: budgetsLoading } = useBudgets();
  const { data: categories = [], isLoading: categoriesLoading } = useCategories();
  const { data: importBatches = [], isLoading: importBatchesLoading } = useImportBatches();
  const { data: monthlyCloseSnapshots = [], isLoading: closeSnapshotsLoading } = useMonthlyCloseSnapshots();
  const saveCloseMutation = useSaveMonthlyCloseSnapshot();
  const reopenCloseMutation = useReopenMonthlyCloseSnapshot();
  const { toast } = useToast();

  const selectedMonthKey = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
  const selectedCloseSnapshot = monthlyCloseSnapshots.find((snapshot) => snapshot.monthKey === selectedMonthKey) ?? null;
  const isClosed = selectedCloseSnapshot?.status === "closed";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setFamilyIncomeJaviMap(getFamilyIncomeJaviMap());
    sync();
    window.addEventListener("octopus-family-income-updated", sync);
    return () => window.removeEventListener("octopus-family-income-updated", sync);
  }, []);

  useEffect(() => {
    setCloseNotes(selectedCloseSnapshot?.notes ?? "");
  }, [selectedCloseSnapshot?.id, selectedCloseSnapshot?.notes, selectedMonthKey]);

  const clientByMonth = useMemo(
    () => summarizeClientPaymentsByMonth(clientPayments),
    [clientPayments],
  );

  const businessIncome = clientByMonth[selectedMonthKey] ?? {
    net: 0,
    vat: 0,
    gross: 0,
    paidNet: 0,
    paidVat: 0,
    paidGross: 0,
  };

  const businessBudget = useMemo(
    () => getEffectiveBudgetTotalForWorkspace("business", categories, budgets, selectedYear, selectedMonth),
    [budgets, categories, selectedMonth, selectedYear],
  );
  const familyBudget = useMemo(
    () => getEffectiveBudgetTotalForWorkspace("family", categories, budgets, selectedYear, selectedMonth),
    [budgets, categories, selectedMonth, selectedYear],
  );

  const prefix = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
  const businessActual = useMemo(
    () => transactions.reduce((sum, tx) => {
      const normalized = normalizeTransaction(tx);
      if (
        normalized.date.startsWith(prefix) &&
        isExecutedTransaction(normalized) &&
        normalized.workspace === "business"
      ) {
        return sum + getTransactionExpenseImpact(normalized, "business");
      }
      return sum;
    }, 0),
    [prefix, transactions],
  );
  const familyActual = useMemo(
    () => transactions.reduce((sum, tx) => {
      const normalized = normalizeTransaction(tx);
      if (
        normalized.date.startsWith(prefix) &&
        isExecutedTransaction(normalized) &&
        normalized.workspace === "family"
      ) {
        return sum + getTransactionExpenseImpact(normalized, "family");
      }
      return sum;
    }, 0),
    [prefix, transactions],
  );

  const familyRealIncome = useMemo(
    () => transactions.reduce((sum, tx) => {
      const normalized = normalizeTransaction(tx);
      if (
        normalized.date.startsWith(prefix) &&
        isExecutedTransaction(normalized) &&
        normalized.workspace === "family" &&
        normalized.type === "income"
      ) {
        return sum + normalized.amount;
      }
      return sum;
    }, 0),
    [prefix, transactions],
  );
  const businessRealIncome = businessIncome.paidNet;
  const familyIncomeJavi = familyIncomeJaviMap[selectedMonthKey] ?? 0;
  const familyOwnIncome = familyRealIncome + familyIncomeJavi;
  const businessRemainderBudget = businessIncome.net - businessBudget;
  const businessRemainderActual = businessRealIncome - businessActual;
  const familyIncomeTotalBudget = businessRemainderBudget + familyOwnIncome;
  const familyIncomeTotalActual = businessRemainderActual + familyOwnIncome;
  const familyBalanceBudget = familyIncomeTotalBudget - familyBudget;
  const familyBalanceActual = familyIncomeTotalActual - familyActual;

  const monthTransactions = useMemo(
    () => transactions.map((transaction) => normalizeTransaction(transaction)).filter((transaction) => transaction.date.startsWith(prefix)),
    [prefix, transactions],
  );
  const pendingTransactions = monthTransactions.filter((transaction) =>
    transaction.status === "pending" && transaction.subtype !== "planned",
  );
  const uncategorizedTransactions = monthTransactions.filter((transaction) =>
    transaction.status !== "cancelled" && isUncategorized(transaction.category),
  );
  const pendingClientPayments = clientPayments.filter((payment) =>
    clientPaymentBelongsToMonth(payment, selectedMonthKey) &&
    payment.status !== "paid" &&
    payment.status !== "cancelled",
  );
  const openImportBatches = importBatches.filter((batch) =>
    batch.status !== "closed" && batchTouchesMonth(batch, selectedMonthKey),
  );
  const legacyExpenseCategories = categories.filter((category) =>
    category.type === "expense" && !category.workspace,
  );

  const liveChecklist = useMemo<MonthlyCloseChecklistItem[]>(() => [
    {
      id: "pending-transactions",
      label: "Movimientos pendientes",
      detail: pendingTransactions.length === 0
        ? "No hay movimientos pendientes en el mes."
        : `${pendingTransactions.length} movimientos siguen pendientes.`,
      status: pendingTransactions.length === 0 ? "ready" : "warning",
      count: pendingTransactions.length,
    },
    {
      id: "uncategorized-transactions",
      label: "Categorías completas",
      detail: uncategorizedTransactions.length === 0
        ? "Todos los movimientos del mes tienen categoría útil."
        : `${uncategorizedTransactions.length} movimientos necesitan categoría antes de confiar en el cierre.`,
      status: uncategorizedTransactions.length === 0 ? "ready" : "blocked",
      count: uncategorizedTransactions.length,
    },
    {
      id: "client-payments",
      label: "Cobros de clientes",
      detail: pendingClientPayments.length === 0
        ? "No quedan cobros de clientes abiertos para el periodo."
        : `${pendingClientPayments.length} cobros siguen abiertos o proyectados.`,
      status: pendingClientPayments.length === 0 ? "ready" : "warning",
      count: pendingClientPayments.length,
    },
    {
      id: "import-batches",
      label: "Cartolas importadas",
      detail: openImportBatches.length === 0
        ? "No hay lotes de importación en revisión para este mes."
        : `${openImportBatches.length} lotes importados siguen abiertos.`,
      status: openImportBatches.length === 0 ? "ready" : "warning",
      count: openImportBatches.length,
    },
    {
      id: "workspace-categories",
      label: "Ámbitos de categorías",
      detail: legacyExpenseCategories.length === 0
        ? "Las categorías de gasto tienen ámbito explícito."
        : `${legacyExpenseCategories.length} categorías de gasto aún dependen de fallback por nombre.`,
      status: legacyExpenseCategories.length === 0 ? "ready" : "warning",
      count: legacyExpenseCategories.length,
    },
    {
      id: "family-income-source",
      label: "Ingreso familiar manual",
      detail: familyIncomeJavi > 0
        ? `Ingreso familiar manual incluido en snapshot: ${formatCLP(familyIncomeJavi)}.`
        : "No hay ingreso familiar manual local para este periodo.",
      status: "ready",
      count: familyIncomeJavi > 0 ? 1 : 0,
    },
  ], [
    familyIncomeJavi,
    legacyExpenseCategories.length,
    openImportBatches.length,
    pendingClientPayments.length,
    pendingTransactions.length,
    uncategorizedTransactions.length,
  ]);

  const liveSummaryRows = useMemo<MonthlyCloseSummaryRow[]>(() => [
    buildSummaryRow("business-income", "Ingreso neto empresa", businessIncome.net, businessRealIncome),
    buildSummaryRow("business-expenses", "Gastos empresa", businessBudget, businessActual),
    buildSummaryRow("business-remainder", "Remanente empresa", businessRemainderBudget, businessRemainderActual),
    buildSummaryRow("family-own-income", "Ingresos familia reales", familyOwnIncome, familyOwnIncome),
    buildSummaryRow("family-total-income", "Ingreso familiar total", familyIncomeTotalBudget, familyIncomeTotalActual),
    buildSummaryRow("family-expenses", "Gastos familia", familyBudget, familyActual),
    buildSummaryRow("family-balance", "Saldo familiar", familyBalanceBudget, familyBalanceActual),
  ], [
    businessActual,
    businessBudget,
    businessIncome.net,
    businessRealIncome,
    businessRemainderActual,
    businessRemainderBudget,
    familyActual,
    familyBalanceActual,
    familyBalanceBudget,
    familyBudget,
    familyIncomeTotalActual,
    familyIncomeTotalBudget,
    familyOwnIncome,
  ]);

  const liveSummary = useMemo(
    () => ({
      businessPaidGross: businessIncome.paidGross,
      businessPaidVat: businessIncome.paidVat,
      businessRemainderActual,
      familyBalanceActual,
      businessActual,
      familyActual,
      familyOwnIncome,
      familyIncomeJavi,
    }),
    [
      businessActual,
      businessIncome.paidGross,
      businessIncome.paidVat,
      businessRemainderActual,
      familyActual,
      familyBalanceActual,
      familyIncomeJavi,
      familyOwnIncome,
    ],
  );

  const displayRows = isClosed ? selectedCloseSnapshot?.rows ?? liveSummaryRows : liveSummaryRows;
  const displayChecklist = isClosed ? selectedCloseSnapshot?.checklist ?? liveChecklist : liveChecklist;
  const displaySummary = isClosed ? selectedCloseSnapshot?.summary ?? liveSummary : liveSummary;
  const checklistBlockedCount = liveChecklist.filter((item) => item.status === "blocked").length;
  const checklistWarningCount = liveChecklist.filter((item) => item.status === "warning").length;
  const checklistReadyCount = liveChecklist.filter((item) => item.status === "ready").length;

  const txYears = new Set(transactions.map((transaction) => parseInt(transaction.date.substring(0, 4), 10)));
  txYears.add(currentPeriod.year);
  const years = Array.from(txYears).sort();

  const handleFreezeClose = () => {
    saveCloseMutation.mutate(
      {
        monthKey: selectedMonthKey,
        year: selectedYear,
        month: selectedMonth,
        notes: closeNotes.trim() || null,
        summary: liveSummary,
        checklist: liveChecklist,
        rows: liveSummaryRows,
      },
      {
        onSuccess: () => {
          toast({
            title: "Cierre congelado",
            description: `Se guardó el snapshot de ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}.`,
          });
        },
      },
    );
  };

  const handleReopenClose = () => {
    reopenCloseMutation.mutate(selectedMonthKey, {
      onSuccess: () => {
        toast({
          title: "Cierre reabierto",
          description: `El periodo ${selectedMonthKey} vuelve a usar datos en vivo.`,
        });
      },
    });
  };

  const isLoading = txLoading || clientLoading || budgetsLoading || categoriesLoading || importBatchesLoading || closeSnapshotsLoading;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="size-5 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">Cierre mensual</h2>
            <p className="text-sm text-muted-foreground">Checklist y snapshot congelable para {MONTH_NAMES[selectedMonth - 1].toLowerCase()} {selectedYear}.</p>
          </div>
        </div>
        <Badge
          variant={isClosed ? "default" : "outline"}
          className={cn("w-fit", isClosed ? "bg-emerald-600 text-white hover:bg-emerald-600" : "border-amber-300 text-amber-700 dark:text-amber-300")}
        >
          {isClosed ? "Cerrado" : selectedCloseSnapshot?.status === "reopened" ? "Reabierto" : "Abierto"}
        </Badge>
      </div>

      <Card data-testid="monthly-close-workspace">
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <span className="text-sm font-medium text-muted-foreground">Mes</span>
                  <Select value={String(selectedMonth)} onValueChange={(value) => setSelectedMonth(parseInt(value, 10))}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.map((name, index) => (
                        <SelectItem key={name} value={String(index + 1)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-sm font-medium text-muted-foreground">Año</span>
                  <Select value={String(selectedYear)} onValueChange={(value) => setSelectedYear(parseInt(value, 10))}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem key={year} value={String(year)}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isClosed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReopenClose}
                    disabled={reopenCloseMutation.isPending}
                  >
                    <RotateCcw className="size-4 mr-2" />
                    {reopenCloseMutation.isPending ? "Reabriendo..." : "Reabrir mes"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleFreezeClose}
                    disabled={saveCloseMutation.isPending || checklistBlockedCount > 0}
                  >
                    <LockKeyhole className="size-4 mr-2" />
                    {saveCloseMutation.isPending ? "Congelando..." : "Congelar cierre"}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">Checklist de cierre</h3>
                    <p className="text-sm text-muted-foreground">
                      {isClosed
                        ? `Snapshot guardado el ${formatDateTime(selectedCloseSnapshot?.closedAt)}.`
                        : `${checklistReadyCount} listos, ${checklistWarningCount} advertencias, ${checklistBlockedCount} bloqueos.`}
                    </p>
                  </div>
                  {checklistBlockedCount > 0 && !isClosed ? (
                    <Badge variant="destructive">Resolver bloqueos</Badge>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {displayChecklist.map((item) => (
                    <div key={item.id} className="rounded-lg border bg-background p-3">
                      <div className="flex items-start gap-2">
                        {item.status === "ready" ? (
                          <CheckCircle2 className="size-4 mt-0.5 text-emerald-600" />
                        ) : (
                          <AlertTriangle className={cn("size-4 mt-0.5", item.status === "blocked" ? "text-red-600" : "text-amber-600")} />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-sm">{item.label}</p>
                            {typeof item.count === "number" ? (
                              <Badge variant="secondary" className="text-[11px]">{item.count}</Badge>
                            ) : null}
                          </div>
                          <p className={cn("text-xs mt-1", getChecklistTone(item.status))}>{item.detail}</p>
                          {!isClosed && item.status !== "ready" && CHECKLIST_RESOLVE_ROUTE[item.id] ? (
                            <Link
                              href={CHECKLIST_RESOLVE_ROUTE[item.id]}
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#bb9eff] hover:underline"
                              data-testid={`checklist-resolve-${item.id}`}
                            >
                              Resolver
                              <ArrowRight className="size-3" />
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border bg-background p-4">
                <div className="flex items-center gap-2">
                  <LockKeyhole className={cn("size-4", isClosed ? "text-emerald-600" : "text-muted-foreground")} />
                  <h3 className="text-sm font-semibold">{isClosed ? "Snapshot congelado" : "Notas para congelar"}</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {isClosed
                    ? "La tabla y las métricas muestran la foto guardada, no el cálculo vivo."
                    : "Estas notas quedan guardadas junto con la foto del mes."}
                </p>
                <Textarea
                  className="mt-3 min-h-28"
                  value={closeNotes}
                  onChange={(event) => setCloseNotes(event.target.value)}
                  placeholder="Notas del cierre, decisiones o ajustes pendientes"
                  disabled={isClosed}
                />
                {!isClosed && checklistBlockedCount > 0 ? (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                    El cierre se puede congelar cuando no haya movimientos sin categoría útil.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Ingresos clientes brutos pagados</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{formatCLP(displaySummary.businessPaidGross ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">IVA del mes</p>
            <p className="text-xl font-semibold tabular-nums mt-1 text-amber-700 dark:text-amber-300">{formatCLP(displaySummary.businessPaidVat ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Remanente empresa real</p>
            <p className={cn("text-xl font-semibold tabular-nums mt-1", (displaySummary.businessRemainderActual ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
              {formatCLP(displaySummary.businessRemainderActual ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Saldo familiar real</p>
            <p className={cn("text-xl font-semibold tabular-nums mt-1", (displaySummary.familyBalanceActual ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
              {formatCLP(displaySummary.familyBalanceActual ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Resumen del cierre {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </CardTitle>
          <CardDescription>
            {isClosed ? "Valores congelados en snapshot." : "Valores calculados en vivo con delta contra presupuesto."}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table className="zebra-stripe">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Concepto</TableHead>
                  <TableHead className="text-right">Presupuesto</TableHead>
                  <TableHead className="text-right">Real</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                  <TableHead className="text-right pr-5">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((row) => {
                  const isTotal = row.id === "family-balance";
                  return (
                    <TableRow key={row.id} className={isTotal ? "border-t-2 font-semibold" : undefined}>
                      <TableCell className="pl-5 font-medium text-sm">{row.label}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatCLP(row.budget)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatCLP(row.actual)}</TableCell>
                      <TableCell className="text-right text-sm">
                        <AmountText value={row.delta} className="text-sm" />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm pr-5">
                        {row.deltaPercent === null ? "-" : `${Math.round(row.deltaPercent * 100)}%`}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
