import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Database,
  FileSearch,
  Inbox,
  ListChecks,
  RotateCcw,
  RotateCw,
  Search,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import type { ImportedMovement } from "@shared/schema";
import type { BulkImportedMovementConversionPreflight } from "@/lib/firestore";
import {
  useAccounts,
  useBulkConvertImportedMovements,
  useCategories,
  useItems,
  useMovementRules,
  useCloseImportBatch,
  useConvertImportedMovement,
  useCreditCardStatements,
  useDiscardImportedMovement,
  useImportBatches,
  useImportedMovements,
  usePreviewBulkImportedMovementConversion,
  useRevertImportedMovementResolution,
  useRollbackImportBatch,
  useSeedDemoImportedMovements,
} from "@/lib/hooks";
import { buildImportedMovementDashboard, normalizeImportText } from "@/domain/bank-imports";
import { itemsForRuleCategory, sanitizeRuleItemId } from "@/domain/movement-rules";
import { extractRuleKeywords } from "@/domain/rule-keywords";
import { LearnRuleDialog, type LearnRuleTarget } from "@/components/finance/learn-rule-dialog";
import { categoryMatchesWorkspace } from "@/domain/categories";
import { openImportWizard, closeImportWizard } from "@/lib/import-wizard";
import { formatCLP } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  FinanceAlertDialogContent,
  FinanceAlertDialogHeader,
  FinanceDialogBody,
  FinanceDialogFooter,
} from "@/components/finance/finance-dialog";
import { StepFlow } from "@/components/finance/step-flow";

type StatusFilter = "active" | "pending" | "duplicate" | "converted" | "reconciled" | "discarded" | "all";

type RowOverride = {
  category?: string;
  itemId?: string | null; // subcategoría (F2 paso 5); null explícito = "sin subcategoría"
  workspace?: string;
  accountId?: string;
  destinationWorkspace?: string;
  destinationAccountId?: string;
  creditCardName?: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  duplicate: "Duplicado",
  converted: "Convertido",
  reconciled: "Conciliado",
  discarded: "Omitido",
};

const WORKSPACE_LABELS: Record<string, string> = {
  business: "Empresa",
  family: "Familia",
  dentist: "Consulta",
  shared: "Compartido",
};

const MOVEMENT_LABELS: Record<string, string> = {
  income: "Ingreso",
  expense: "Gasto",
  transfer: "Traspaso",
  credit_card_payment: "Pago tarjeta",
};

const PAYMENT_LABELS: Record<string, string> = {
  bank_account: "Cuenta",
  credit_card: "Tarjeta",
  cash: "Caja",
};

const BATCH_STATUS_LABELS: Record<string, string> = {
  reviewing: "En revision",
  partially_converted: "Parcial",
  completed: "Listo para cerrar",
  closed: "Cerrado",
};

function batchStatusTone(status: string) {
  if (status === "closed") return "bg-[rgba(205,250,70,0.14)] text-[#cdfa46]";
  if (status === "completed") return "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]";
  if (status === "partially_converted") return "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]";
  return "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]";
}

function statusTone(status: string) {
  if (status === "converted" || status === "reconciled") return "bg-[rgba(205,250,70,0.14)] text-[#cdfa46]";
  if (status === "duplicate") return "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]";
  if (status === "discarded") return "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]";
  return "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]";
}

function confidenceTone(value: number) {
  return value >= 85 ? "text-[#cdfa46]" : "text-[#8a8a94]";
}

function confidenceBorder(value: number) {
  if (value >= 85) return "border-l-4 border-l-[#cdfa46]";
  return "border-l-4 border-l-[#3a3a44]";
}

function formatShortDate(date: string) {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${day}/${month}/${year}`;
}

function formatPreflightCandidate(candidate: { date: string; description: string }) {
  return `${formatShortDate(candidate.date)} · ${candidate.description}`;
}

function movementCategoryType(movement: ImportedMovement) {
  return movement.suggestedMovementType === "income" ? "income" : "expense";
}

function accountLabel(account: { bank?: string | null; name?: string | null } | null | undefined) {
  if (!account) return "Sin cuenta";
  const bank = account.bank?.trim();
  const name = account.name?.trim();
  return [bank, name].filter(Boolean).join(" · ") || "Sin nombre";
}

export default function BankMovementsPage({
  embedded = false,
  batchIdOverride,
  onDone,
}: {
  /** Embebido en el wizard de importación: oculta el chrome de página. */
  embedded?: boolean;
  /** Acota la bandeja a un lote concreto (en vez de leerlo de la URL). */
  batchIdOverride?: string;
  /** Se dispara cuando se confirma la conversión del lote. */
  onDone?: () => void;
} = {}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [batchFilter, setBatchFilter] = useState("latest");
  const [rollbackBatchId, setRollbackBatchId] = useState<string | null>(null);
  const [closeBatchId, setCloseBatchId] = useState<string | null>(null);
  const [bulkPreflightOpen, setBulkPreflightOpen] = useState(false);
  const [bulkPreflight, setBulkPreflight] = useState<BulkImportedMovementConversionPreflight | null>(null);
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useState<Record<string, RowOverride>>({});
  const [learnTarget, setLearnTarget] = useState<LearnRuleTarget | null>(null);

  const { data: batches = [], isLoading: batchesLoading } = useImportBatches();
  const latestBatchId = batches[0]?.id ?? null;
  const selectedBatchId =
    batchFilter === "all"
      ? null
      : batchFilter === "latest"
        ? latestBatchId
        : batchFilter;
  const movementsQueryEnabled = batchFilter === "all" || Boolean(selectedBatchId);
  const { data: movements = [], isLoading: movementsLoading } = useImportedMovements({
    batchId: selectedBatchId,
    enabled: movementsQueryEnabled,
  });
  const { data: categories = [] } = useCategories();
  const { data: items = [] } = useItems();
  const { data: movementRules = [] } = useMovementRules();
  const { data: accounts = [] } = useAccounts();
  const { data: cardStatements = [] } = useCreditCardStatements();
  // Tarjetas conocidas (de los estados de cuenta), distinct por last4, para asignar un pago a su tarjeta.
  const cardOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const s of cardStatements as Array<{ last4?: string; cardLabel?: string }>) {
      const last4 = String(s.last4 ?? "");
      if (!/^\d{4}$/.test(last4) || seen.has(last4)) continue;
      seen.add(last4);
      out.push({ value: s.cardLabel || `Tarjeta …${last4}`, label: s.cardLabel || `Tarjeta …${last4}` });
    }
    return out;
  }, [cardStatements]);

  const seedDemoMutation = useSeedDemoImportedMovements();
  const convertMutation = useConvertImportedMovement();
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [recentlyConverted, setRecentlyConverted] = useState<Set<string>>(new Set());
  const bulkConvertMutation = useBulkConvertImportedMovements();
  const bulkPreflightMutation = usePreviewBulkImportedMovementConversion();
  const discardMutation = useDiscardImportedMovement();
  const revertResolutionMutation = useRevertImportedMovementResolution();
  const rollbackBatchMutation = useRollbackImportBatch();
  const closeBatchMutation = useCloseImportBatch();

  useEffect(() => {
    if (batchIdOverride) {
      setBatchFilter(batchIdOverride);
      return;
    }
    const batchId = new URLSearchParams(searchString).get("batch");
    setBatchFilter(batchId || "latest");
  }, [searchString, batchIdOverride]);

  const visibleMovements = useMemo(() => {
    const needle = normalizeImportText(search);

    return movements.filter((movement) => {
      // Mantener visible ~2s una fila recién convertida para mostrar "✓ Convertido" antes de que salga.
      if (statusFilter === "active" && !["pending", "duplicate"].includes(movement.status) && !recentlyConverted.has(movement.id)) return false;
      if (statusFilter !== "active" && statusFilter !== "all" && movement.status !== statusFilter && !recentlyConverted.has(movement.id)) return false;
      if (!needle) return true;

      return normalizeImportText([
        movement.description,
        movement.suggestedCategory,
        movement.sourceName,
        movement.bankName,
        movement.creditCardName,
      ].filter(Boolean).join(" ")).includes(needle);
    });
  }, [movements, search, statusFilter, recentlyConverted]);

  const dashboard = useMemo(
    () => buildImportedMovementDashboard(movements),
    [movements],
  );

  const selectedBatch = useMemo(
    () => selectedBatchId ? batches.find((batch) => batch.id === selectedBatchId) ?? null : null,
    [batches, selectedBatchId],
  );
  const selectedBatchPeriod = useMemo(() => {
    const dates = movements.map((movement) => movement.date).filter(Boolean).sort();
    if (!dates.length) return null;
    const start = dates[0];
    const end = dates[dates.length - 1];
    return start === end ? formatShortDate(start) : `${formatShortDate(start)} - ${formatShortDate(end)}`;
  }, [movements]);

  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );

  const pendingHighConfidenceIds = useMemo(
    () =>
      movements
        .filter((movement) => movement.status === "pending" && Number(movement.confidence) >= 85)
        .map((movement) => movement.id),
    [movements],
  );
  const bulkPreflightIssues = useMemo(() => {
    if (!bulkPreflight) return [];
    return [
      ...bulkPreflight.duplicates.map((candidate) => ({ ...candidate, tone: "Duplicado" })),
      ...bulkPreflight.reviewRequired.map((candidate) => ({ ...candidate, tone: "Revisar" })),
      ...bulkPreflight.blocked.map((candidate) => ({ ...candidate, tone: "Bloqueado" })),
    ];
  }, [bulkPreflight]);

  const categoryOptionsByType = useMemo(() => {
    const income = new Set<string>();
    const expense = new Set<string>();

    for (const category of categories) {
      if (category.type === "income") income.add(category.name);
      if (category.type === "expense") expense.add(category.name);
    }

    for (const movement of movements) {
      if (movementCategoryType(movement) === "income") {
        income.add(movement.suggestedCategory);
      } else {
        expense.add(movement.suggestedCategory);
      }
    }

    return {
      income: Array.from(income).sort((left, right) => left.localeCompare(right, "es")),
      expense: Array.from(expense).sort((left, right) => left.localeCompare(right, "es")),
    };
  }, [categories, movements]);

  const categoryByName = useMemo(() => {
    const map = new Map<string, (typeof categories)[number]>();
    for (const category of categories) map.set(category.name, category);
    return map;
  }, [categories]);

  // Filtra los nombres por el ámbito de la fila: deja las del ámbito + compartidas
  // + las que no son categorías reales (sugerencias del movimiento) + la elegida.
  const filterCategoryOptionsByWorkspace = (options: string[], workspace: string | undefined, selected: string) =>
    options.filter((name) => {
      if (name === selected) return true;
      const category = categoryByName.get(name);
      if (!category) return true;
      return categoryMatchesWorkspace(category, workspace);
    });

  const setRowOverride = (movementId: string, patch: RowOverride) => {
    setOverrides((current) => ({
      ...current,
      [movementId]: {
        ...current[movementId],
        ...patch,
      },
    }));
  };

  const handleSeedDemo = async () => {
    try {
      const result = await seedDemoMutation.mutateAsync();
      setBatchFilter(result.batchId);
      setStatusFilter("active");
      toast({
        title: "Lote demo cargado",
        description: `${result.pending} pendientes y ${result.duplicates} duplicados detectados.`,
      });
    } catch (error) {
      toast({
        title: "No se pudo cargar el demo",
        description: error instanceof Error ? error.message : "Revisa la conexion con Firebase.",
        variant: "destructive",
      });
    }
  };

  const handleConvert = async (movement: ImportedMovement) => {
    const rowOverride = overrides[movement.id] ?? {};
    const accountId = rowOverride.accountId === "none" ? null : rowOverride.accountId;
    const destinationAccountId = rowOverride.destinationAccountId === "none" ? null : rowOverride.destinationAccountId;
    // Subcategoría: override explícito (incl. null) gana sobre la sugerida; se sanea contra la categoría final.
    const effectiveCategory = rowOverride.category ?? movement.suggestedCategory;
    const effectiveWorkspace = rowOverride.workspace ?? movement.suggestedWorkspace;
    const effectiveItemId = rowOverride.itemId !== undefined ? rowOverride.itemId : (movement.suggestedItemId ?? null);
    const itemId = sanitizeRuleItemId(categories, items, effectiveCategory, movement.suggestedMovementType, effectiveWorkspace, effectiveItemId);

    setConvertingId(movement.id);
    try {
      await convertMutation.mutateAsync({
        id: movement.id,
        override: {
          category: rowOverride.category,
          itemId,
          workspace: rowOverride.workspace,
          accountId,
          destinationWorkspace: rowOverride.destinationWorkspace,
          destinationAccountId,
          creditCardName: rowOverride.creditCardName,
        },
        forceDuplicate: movement.status === "duplicate",
      });
      toast({
        title: "Movimiento convertido",
        description: `${movement.description} quedo como transaccion real.`,
      });
      // Mantener "✓ Convertido" en el botón ~2s antes de que la fila salga de la bandeja.
      const id = movement.id;
      setRecentlyConverted((s) => new Set(s).add(id));
      setTimeout(() => setRecentlyConverted((s) => { const n = new Set(s); n.delete(id); return n; }), 2200);
    } catch (error) {
      toast({
        title: "No se pudo convertir",
        description: error instanceof Error ? error.message : "El movimiento no cambio de estado.",
        variant: "destructive",
      });
    } finally {
      setConvertingId(null);
    }
  };

  const handleBulkConvert = async () => {
    if (!pendingHighConfidenceIds.length) return;

    try {
      const preflight = await bulkPreflightMutation.mutateAsync(pendingHighConfidenceIds);
      setBulkPreflight(preflight);
      setBulkPreflightOpen(true);
    } catch (error) {
      toast({
        title: "No se pudo revisar el lote",
        description: error instanceof Error ? error.message : "Intenta convertir fila por fila para aislar el problema.",
        variant: "destructive",
      });
    }
  };

  const handleConfirmBulkConvert = async () => {
    if (!bulkPreflight) return;

    try {
      const result = await bulkConvertMutation.mutateAsync(bulkPreflight.requestedIds);
      const failedCount = result.failed?.length ?? 0;
      setBulkPreflightOpen(false);
      setBulkPreflight(null);
      toast({
        title: failedCount ? "Conversion masiva con observaciones" : "Conversion masiva lista",
        description: failedCount
          ? `${result.converted} convertidos, ${result.duplicatesMarked ?? 0} duplicados, ${result.reviewRequired ?? 0} por revisar y ${result.blocked ?? 0} bloqueados.`
          : `${result.converted} convertidos, ${result.skipped} omitidos.`,
        variant: failedCount ? "destructive" : "default",
      });
    } catch {
      toast({
        title: "No se pudo convertir el lote",
        description: "Convierte fila por fila para aislar el problema.",
        variant: "destructive",
      });
    }
  };

  const handleDiscard = async (movement: ImportedMovement) => {
    try {
      await discardMutation.mutateAsync(movement.id);
      toast({
        title: "Movimiento omitido",
        description: movement.description,
      });
    } catch {
      toast({
        title: "No se pudo omitir",
        variant: "destructive",
      });
    }
  };

  const handleRevertResolution = async (movement: ImportedMovement) => {
    try {
      const result = await revertResolutionMutation.mutateAsync(movement.id);
      toast({
        title: "Resolución deshecha",
        description: result.transactionDeleted
          ? "La transacción creada por la cartola fue eliminada y el movimiento volvió a revisión."
          : "La conciliación fue deshecha y el movimiento volvió a revisión.",
      });
      setStatusFilter("pending");
    } catch (error) {
      toast({
        title: "No se pudo deshacer",
        description: error instanceof Error ? error.message : "El movimiento no cambió de estado.",
        variant: "destructive",
      });
    }
  };

  const handleRollbackBatch = async () => {
    if (!rollbackBatchId) return;

    try {
      const result = await rollbackBatchMutation.mutateAsync(rollbackBatchId);
      setRollbackBatchId(null);
      setStatusFilter("discarded");
      toast({
        title: result.alreadyClosed ? "Lote ya estaba cerrado" : "Lote omitido",
        description: result.alreadyClosed
          ? "No habia movimientos pendientes para cambiar."
          : result.convertedRemaining
            ? `${result.discarded} movimientos fueron omitidos. ${result.convertedRemaining} ya resueltos se mantienen intactos.`
            : `${result.discarded} movimientos pendientes o duplicados fueron omitidos.`,
      });
    } catch (error) {
      toast({
        title: "No se pudo omitir el lote",
        description: error instanceof Error ? error.message : "Intenta omitir movimientos individualmente.",
        variant: "destructive",
      });
    }
  };

  const handleCloseBatch = async () => {
    if (!closeBatchId) return;

    try {
      const result = await closeBatchMutation.mutateAsync(closeBatchId);
      setCloseBatchId(null);
      setStatusFilter("all");
      toast({
        title: "Lote cerrado",
        description: `${result.summary.converted} convertidos, ${result.summary.reconciled} conciliados y ${result.summary.discarded} omitidos. El lote quedo bloqueado para nuevas revisiones.`,
      });
      onDone?.();
    } catch (error) {
      toast({
        title: "No se pudo cerrar el lote",
        description: error instanceof Error ? error.message : "Revisa pendientes y duplicados antes de cerrar.",
        variant: "destructive",
      });
    }
  };

  const isLoading = batchesLoading || movementsLoading;
  const rollbackCandidates = dashboard.pending + dashboard.duplicate;
  const isSelectedBatchClosed = selectedBatch?.status === "closed";
  const canRollbackSelectedBatch = Boolean(selectedBatchId) && batchFilter !== "all" && rollbackCandidates > 0 && !isSelectedBatchClosed;
  const canCloseSelectedBatch =
    Boolean(selectedBatchId) &&
    batchFilter !== "all" &&
    dashboard.total > 0 &&
    rollbackCandidates === 0 &&
    !isSelectedBatchClosed;
  const isAllBatchesView = batchFilter === "all";
  const scopeLabel = isAllBatchesView ? "en la vista" : "en el lote";
  const isSelectedBatchComplete = !isAllBatchesView && dashboard.total > 0 && dashboard.pending === 0 && dashboard.duplicate === 0;

  return (
    <>
    <div className={embedded ? "" : "h-full overflow-auto bg-background"}>
      <div className={embedded ? "flex w-full flex-col gap-5" : "mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-5 lg:px-6"}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            {!embedded && (
              <>
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Inbox className="size-4" />
                  Conciliacion bancaria
                </div>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                  Revision de movimientos
                </h1>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Bandeja previa para revisar cartolas, detectar duplicados y convertir movimientos aprobados en transacciones.
                </p>
              </>
            )}
            {selectedBatch ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Lote actual</Badge>
                <span>{selectedBatch.label}</span>
                <Badge className={batchStatusTone(selectedBatch.status)}>
                  {BATCH_STATUS_LABELS[selectedBatch.status] ?? selectedBatch.status}
                </Badge>
                {selectedBatchPeriod ? <span>· {selectedBatchPeriod}</span> : null}
                <span>· {dashboard.total} movimientos</span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {!embedded && (
              <>
                <Button
                  onClick={openImportWizard}
                  data-testid="button-import-bank-statement"
                >
                  <Upload className="mr-2 size-4" />
                  Importar cartola
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSeedDemo}
                  disabled={seedDemoMutation.isPending}
                  data-testid="button-seed-demo-movements"
                >
                  <Database className="mr-2 size-4" />
                  Cargar demo
                </Button>
              </>
            )}
            <Button
              onClick={handleBulkConvert}
              disabled={!pendingHighConfidenceIds.length || bulkConvertMutation.isPending || bulkPreflightMutation.isPending || isSelectedBatchClosed}
              data-testid="button-convert-confident-movements"
            >
              <ListChecks className="mr-2 size-4" />
              {bulkPreflightMutation.isPending
                ? "Revisando..."
                : pendingHighConfidenceIds.length > 0
                ? `Convertir ${pendingHighConfidenceIds.length} confiables`
                : "Convertir confiables"}
            </Button>
            <Button
              variant="outline"
              onClick={() => selectedBatchId && setRollbackBatchId(selectedBatchId)}
              disabled={!canRollbackSelectedBatch || rollbackBatchMutation.isPending}
              data-testid="button-rollback-import-batch"
            >
              <XCircle className="mr-2 size-4" />
              Omitir lote
            </Button>
            <Button
              variant="outline"
              onClick={() => selectedBatchId && setCloseBatchId(selectedBatchId)}
              disabled={!canCloseSelectedBatch || closeBatchMutation.isPending}
              data-testid="button-close-import-batch"
            >
              <CheckCircle2 className="mr-2 size-4" />
              Cerrar lote
            </Button>
          </div>
        </div>

        {!embedded && (
          <StepFlow
            steps={[
              { label: "Importar cartola", hint: "Subí el CSV o PDF", onClick: openImportWizard },
              { label: "Revisar y clasificar", hint: "Categoría, cuenta y duplicados" },
              { label: "Confirmar", hint: "Convertir en transacciones" },
            ]}
          />
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Card className="rounded-lg">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pendientes</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-semibold">{dashboard.pending}</div>
              <div className="text-xs text-muted-foreground">{dashboard.total} en el lote</div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Duplicados</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-semibold">{dashboard.duplicate}</div>
              <div className="text-xs text-muted-foreground">Requieren forzar o omitir</div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Ingreso pendiente</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-semibold">{formatCLP(dashboard.pendingIncome)}</div>
              <div className="text-xs text-muted-foreground">Por confirmar</div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Salida pendiente</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-semibold">{formatCLP(dashboard.pendingExpense)}</div>
              <div className="text-xs text-muted-foreground">Gastos, tarjetas y traspasos</div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Confianza</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="flex items-end justify-between gap-3">
                <div className="text-2xl font-semibold">{dashboard.averageConfidence}%</div>
                <Badge variant="outline">{dashboard.converted + dashboard.reconciled} resueltos</Badge>
              </div>
              <Progress className="mt-3 h-2" value={dashboard.averageConfidence} />
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-lg">
          <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar descripcion, categoria o banco"
                className="pl-9"
              />
            </div>
            {!embedded && (
              <Select value={batchFilter} onValueChange={setBatchFilter}>
                <SelectTrigger className="w-full lg:w-[280px]">
                  <SelectValue placeholder="Lote" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Ultimo lote</SelectItem>
                  <SelectItem value="all">Todos los lotes</SelectItem>
                  {batches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger className="w-full lg:w-[210px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Pendientes y duplicados</SelectItem>
                <SelectItem value="pending">Solo pendientes</SelectItem>
                <SelectItem value="duplicate">Solo duplicados</SelectItem>
                <SelectItem value="converted">Convertidos</SelectItem>
                <SelectItem value="reconciled">Conciliados</SelectItem>
                <SelectItem value="discarded">Omitidos</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Bandeja de revision</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {isLoading ? "Cargando movimientos..." : `${visibleMovements.length} visibles de ${dashboard.total} ${scopeLabel}`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatusFilter("active");
                setBatchFilter("latest");
              }}
            >
              <RotateCw className="mr-2 size-4" />
              Limpiar filtros
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {visibleMovements.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center">
                {isSelectedBatchComplete ? (
                  <>
                    <CheckCircle2 className="size-10 text-lime-500" />
                    <div>
                      <div className="font-medium">Lote procesado</div>
                      <p className="mt-1 max-w-md text-sm text-muted-foreground">
                        {dashboard.converted} convertidos, {dashboard.reconciled} conciliados y {dashboard.discarded} omitidos. No quedan pendientes ni duplicados en este lote.
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        onClick={() => {
                          closeImportWizard(); // cierra el modal del wizard si está abierto
                          navigate("/transactions");
                        }}
                      >
                        Ver transacciones
                        <ArrowRight className="ml-2 size-4" />
                      </Button>
                      <Button variant="outline" onClick={openImportWizard}>
                        Importar nuevo lote
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <FileSearch className="size-10 text-muted-foreground" />
                    <div>
                      <div className="font-medium">No hay movimientos para revisar</div>
                      <p className="mt-1 max-w-md text-sm text-muted-foreground">
                        Importa una cartola para cargar movimientos reales o cambia los filtros si ya hay lotes importados.
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        onClick={openImportWizard}
                        data-testid="button-import-empty-movements"
                      >
                        <Upload className="mr-2 size-4" />
                        Importar cartola
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleSeedDemo}
                        disabled={seedDemoMutation.isPending}
                        data-testid="button-seed-demo-empty-movements"
                      >
                        <Database className="mr-2 size-4" />
                        Cargar demo
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[260px]">Movimiento</TableHead>
                      <TableHead className="min-w-[150px]">Monto</TableHead>
                      <TableHead className="min-w-[170px]">Clasificacion</TableHead>
                      <TableHead className="min-w-[190px]">Categoria</TableHead>
                      <TableHead className="min-w-[180px]">Subcategoria</TableHead>
                      <TableHead className="min-w-[160px]">Ambito</TableHead>
                      <TableHead className="min-w-[220px]">Cuenta</TableHead>
                      <TableHead className="min-w-[130px]">Estado</TableHead>
                      <TableHead className="min-w-[190px] text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleMovements.map((movement) => {
                      const rowOverride = overrides[movement.id] ?? {};
                      const categoryType = movementCategoryType(movement);
                      const selectedCategory = rowOverride.category ?? movement.suggestedCategory;
                      const selectedWorkspace = rowOverride.workspace ?? movement.suggestedWorkspace;
                      const categoryOptions = filterCategoryOptionsByWorkspace(
                        categoryOptionsByType[categoryType],
                        selectedWorkspace,
                        selectedCategory,
                      );
                      // Subcategoría: override explícito (incl. null) gana; se saneada contra la categoría.
                      const rowItems = itemsForRuleCategory(categories, items, selectedCategory, movement.suggestedMovementType, selectedWorkspace);
                      const effectiveItemId = rowOverride.itemId !== undefined ? rowOverride.itemId : (movement.suggestedItemId ?? null);
                      const selectedItemId = sanitizeRuleItemId(categories, items, selectedCategory, movement.suggestedMovementType, selectedWorkspace, effectiveItemId);
                      const isTransfer = movement.suggestedMovementType === "transfer";
                      const isCardPayment = movement.suggestedMovementType === "credit_card_payment";
                      const selectedCardName = rowOverride.creditCardName ?? movement.creditCardName ?? "";
                      const selectedAccountId = rowOverride.accountId ?? movement.suggestedSourceAccountId ?? movement.accountId ?? "none";
                      const selectedDestWorkspace = rowOverride.destinationWorkspace ?? movement.suggestedDestinationWorkspace ?? "";
                      const selectedDestAccountId = rowOverride.destinationAccountId ?? movement.suggestedDestinationAccountId ?? "none";
                      const accountOptions = accounts.filter(
                        (account) => account.type === "checking" || account.type === "savings" || (isTransfer && account.type === "credit_line"),
                      );
                      const canReview = !isSelectedBatchClosed && (movement.status === "pending" || movement.status === "duplicate");
                      const sourceAccount = movement.accountId ? accountById.get(movement.accountId) : null;

                      return (
                        <TableRow
                          key={movement.id}
                          className={`${canReview ? confidenceBorder(Number(movement.confidence) || 0) : "border-l-4 border-l-transparent"} ${
                            movement.status === "duplicate" ? "bg-zinc-50/50 dark:bg-zinc-950/10" : ""
                          }`}
                        >
                          <TableCell className="align-top">
                            <div className="font-medium">{movement.description}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {formatShortDate(movement.date)} · {movement.sourceName}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              <Badge variant="outline">
                                {PAYMENT_LABELS[movement.suggestedPaymentMethod] ?? movement.suggestedPaymentMethod}
                              </Badge>
                              {movement.creditCardName ? (
                                <Badge variant="outline">{movement.creditCardName}</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className={movement.direction === "income" ? "font-semibold text-[hsl(var(--money-in))]" : "font-semibold"}>
                              {movement.direction === "income" ? "+" : "-"}{formatCLP(movement.amount)}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">{movement.currency}</div>
                          </TableCell>
                          <TableCell className="align-top">
                            <Badge variant="outline">
                              {MOVEMENT_LABELS[movement.suggestedMovementType] ?? movement.suggestedMovementType}
                            </Badge>
                            <div className={`mt-2 text-xs font-medium ${confidenceTone(Number(movement.confidence) || 0)}`}>
                              {movement.confidence}% confianza
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <Select
                              value={selectedCategory}
                              onValueChange={(value) => setRowOverride(movement.id, { category: value, itemId: null })}
                              disabled={!canReview}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Categoria" />
                              </SelectTrigger>
                              <SelectContent>
                                {categoryOptions.map((category) => (
                                  <SelectItem key={`${movement.id}-${category}`} value={category}>
                                    {category}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="align-top">
                            {rowItems.length === 0 || isTransfer || isCardPayment ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <Select
                                value={selectedItemId ?? "__none__"}
                                onValueChange={(value) => setRowOverride(movement.id, { itemId: value === "__none__" ? null : value })}
                                disabled={!canReview}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder="Subcategoria" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Sin subcategoria</SelectItem>
                                  {rowItems.map((item) => (
                                    <SelectItem key={`${movement.id}-${item.id}`} value={item.id}>{item.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            <Select
                              value={selectedWorkspace}
                              onValueChange={(value) => setRowOverride(movement.id, { workspace: value })}
                              disabled={!canReview}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Ambito" />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(WORKSPACE_LABELS).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="align-top">
                            <Select
                              value={selectedAccountId}
                              onValueChange={(value) => setRowOverride(movement.id, { accountId: value })}
                              disabled={!canReview || movement.suggestedPaymentMethod === "credit_card"}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Cuenta" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Sin cuenta</SelectItem>
                                {accountOptions.map((account) => (
                                  <SelectItem key={account.id} value={account.id}>
                                    {accountLabel(account)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {isTransfer ? "Origen · detectada: " : "Detectada: "}{accountLabel(sourceAccount)}
                            </div>
                            {isTransfer && (
                              <div className="mt-2 space-y-1 border-t border-dashed pt-2">
                                <div className="text-xs font-medium text-muted-foreground">Destino del traspaso</div>
                                <Select
                                  value={selectedDestWorkspace || undefined}
                                  onValueChange={(value) => setRowOverride(movement.id, { destinationWorkspace: value })}
                                  disabled={!canReview}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Ámbito destino" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(WORKSPACE_LABELS).map(([value, label]) => (
                                      <SelectItem key={`dw-${value}`} value={value}>
                                        {label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Select
                                  value={selectedDestAccountId}
                                  onValueChange={(value) => setRowOverride(movement.id, { destinationAccountId: value })}
                                  disabled={!canReview}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Cuenta destino" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">Sin cuenta</SelectItem>
                                    {accountOptions
                                      .filter((account) => account.id !== selectedAccountId)
                                      .map((account) => (
                                        <SelectItem key={`dest-${account.id}`} value={account.id}>
                                          {accountLabel(account)}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            {isCardPayment && (
                              <div className="mt-2 space-y-1 border-t border-dashed pt-2">
                                <div className="text-xs font-medium text-muted-foreground">Tarjeta pagada</div>
                                <Select
                                  value={selectedCardName || undefined}
                                  onValueChange={(value) => setRowOverride(movement.id, { creditCardName: value })}
                                  disabled={!canReview}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="¿A qué tarjeta?" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {cardOptions.map((c) => (
                                      <SelectItem key={`cc-${c.value}`} value={c.value}>
                                        {c.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            <Badge className={statusTone(movement.status)}>
                              {STATUS_LABELS[movement.status] ?? movement.status}
                            </Badge>
                            {movement.duplicateMovementId || movement.duplicateTransactionId ? (
                              <div className="mt-2 text-xs text-muted-foreground">Coincidencia previa</div>
                            ) : null}
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex justify-end gap-2">
                              {(() => {
                                // "Corregido" = el valor final difiere de la sugerencia (no basta con tocar el select).
                                const corrected =
                                  selectedCategory !== movement.suggestedCategory ||
                                  selectedItemId !== (movement.suggestedItemId ?? null);
                                const isIncomeOrExpense = movement.suggestedMovementType === "income" || movement.suggestedMovementType === "expense";
                                const canLearn =
                                  canReview && corrected && isIncomeOrExpense &&
                                  selectedCategory && selectedCategory !== "Sin categoría" && selectedCategory !== "Sin categoria" &&
                                  extractRuleKeywords(movement.description).length > 0;
                                return canLearn ? (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-9 text-primary/80 hover:text-primary"
                                    title="Aprender una regla de esta corrección"
                                    onClick={() => setLearnTarget({
                                      id: movement.id,
                                      name: movement.description,
                                      category: selectedCategory,
                                      itemId: selectedItemId,
                                      workspace: selectedWorkspace,
                                      type: movement.suggestedMovementType === "income" ? "income" : "expense",
                                      accountType: movement.suggestedPaymentMethod === "credit_card" ? "credit" : "bank",
                                    })}
                                  >
                                    <Sparkles className="size-4" />
                                  </Button>
                                ) : null;
                              })()}
                              <Button
                                size="sm"
                                onClick={() => handleConvert(movement)}
                                disabled={!canReview || convertingId === movement.id || recentlyConverted.has(movement.id)}
                                className={recentlyConverted.has(movement.id) ? "bg-[#cdfa46] text-black hover:bg-[#cdfa46]" : undefined}
                              >
                                <CheckCircle2 className="mr-2 size-4" />
                                {recentlyConverted.has(movement.id)
                                  ? "Convertido"
                                  : convertingId === movement.id
                                    ? "Convirtiendo…"
                                    : movement.status === "duplicate" ? "Forzar" : "Convertir"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDiscard(movement)}
                                disabled={!["pending", "duplicate"].includes(movement.status) || discardMutation.isPending}
                              >
                                <XCircle className="mr-2 size-4" />
                                Omitir
                              </Button>
                            </div>
                            {["converted", "reconciled"].includes(movement.status) && movement.matchedTransactionId ? (
                              <div className="mt-2 flex flex-col items-end gap-2">
                                <div className="flex justify-end text-xs text-muted-foreground">
                                  <BadgeCheck className="mr-1 size-3" />
                                  {movement.status === "reconciled" ? "Transaccion conciliada" : "Transaccion creada"}
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleRevertResolution(movement)}
                                  disabled={revertResolutionMutation.isPending}
                                >
                                  <RotateCcw className="mr-2 size-4" />
                                  Deshacer
                                </Button>
                              </div>
                            ) : null}
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
      </div>
    </div>
    <LearnRuleDialog
      open={learnTarget !== null}
      onOpenChange={(open) => { if (!open) setLearnTarget(null); }}
      target={learnTarget}
      rules={movementRules}
      categories={categories}
      items={items}
    />
    <AlertDialog open={Boolean(rollbackBatchId)} onOpenChange={(open) => {
      if (!open) setRollbackBatchId(null);
    }}>
      <FinanceAlertDialogContent>
        <FinanceAlertDialogHeader
          icon={<XCircle className="size-4" />}
          title="Omitir pendientes del lote"
          description={
            selectedBatch
              ? `${selectedBatch.label} tiene ${rollbackCandidates} movimientos pendientes o duplicados por omitir.`
              : `Se omitirán ${rollbackCandidates} movimientos pendientes o duplicados.`
          }
        />
        <FinanceDialogBody className="space-y-4">
          <div className="rounded-xl border border-[#8a8a94]/20 bg-[#8a8a94]/10 px-4 py-3 text-sm text-[#cfcfd8]">
            Los {dashboard.converted} convertidos y {dashboard.reconciled} conciliados permanecerán como movimientos resueltos.
          </div>
        </FinanceDialogBody>
        <FinanceDialogFooter>
          <AlertDialogCancel
            className="border-white/10 bg-[#15151c] text-[#f4f4f7] hover:bg-[#22222b]"
            disabled={rollbackBatchMutation.isPending}
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-[#8a8a94] text-[#0a0a0f] hover:bg-[#fbbf24]"
            onClick={(event) => {
              event.preventDefault();
              void handleRollbackBatch();
            }}
            disabled={rollbackBatchMutation.isPending}
          >
            {rollbackBatchMutation.isPending ? "Omitiendo..." : "Omitir lote"}
          </AlertDialogAction>
        </FinanceDialogFooter>
      </FinanceAlertDialogContent>
    </AlertDialog>
    <AlertDialog open={Boolean(closeBatchId)} onOpenChange={(open) => {
      if (!open) setCloseBatchId(null);
    }}>
      <FinanceAlertDialogContent>
        <FinanceAlertDialogHeader
          icon={<CheckCircle2 className="size-4" />}
          title="Cerrar lote importado"
          description={
            selectedBatch
              ? `Se cerrará ${selectedBatch.label}. Ya no quedan pendientes ni duplicados.`
              : "Se cerrará este lote importado."
          }
        />
        <FinanceDialogBody>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-white/7 bg-[#15151c] px-4 py-3">
              <p className="text-xs text-[#9a9aa6]">Convertidos</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-[#cdfa46]">{dashboard.converted}</p>
            </div>
            <div className="rounded-xl border border-white/7 bg-[#15151c] px-4 py-3">
              <p className="text-xs text-[#9a9aa6]">Conciliados</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-[#cdfa46]">{dashboard.reconciled}</p>
            </div>
            <div className="rounded-xl border border-white/7 bg-[#15151c] px-4 py-3">
              <p className="text-xs text-[#9a9aa6]">Omitidos</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-[#8a8a94]">{dashboard.discarded}</p>
            </div>
          </div>
        </FinanceDialogBody>
        <FinanceDialogFooter>
          <AlertDialogCancel
            className="border-white/10 bg-[#15151c] text-[#f4f4f7] hover:bg-[#22222b]"
            disabled={closeBatchMutation.isPending}
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-[#cdfa46] text-[#0a0a0f] hover:bg-[#cdfa46]"
            onClick={(event) => {
              event.preventDefault();
              void handleCloseBatch();
            }}
            disabled={closeBatchMutation.isPending}
          >
            {closeBatchMutation.isPending ? "Cerrando..." : "Cerrar lote"}
          </AlertDialogAction>
        </FinanceDialogFooter>
      </FinanceAlertDialogContent>
    </AlertDialog>
    <AlertDialog open={bulkPreflightOpen} onOpenChange={(open) => {
      setBulkPreflightOpen(open);
      if (!open && !bulkConvertMutation.isPending) setBulkPreflight(null);
    }}>
      <FinanceAlertDialogContent size="md">
        <FinanceAlertDialogHeader
          icon={<ListChecks className="size-4" />}
          title="Confirmar importación"
          description={`Paso 3 de 3 · Revisa ${bulkPreflight?.total ?? 0} movimientos de alta confianza antes de crear transacciones reales.`}
        />
        {bulkPreflight ? (
          <FinanceDialogBody className="space-y-4">
            <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-card/60">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">Movimientos a crear</span>
                <span className="font-mono text-lg font-semibold tabular-nums text-[#cdfa46]">{bulkPreflight.ready}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Duplicados a descartar</span>
                <span className="font-mono text-lg font-semibold tabular-nums">{bulkPreflight.duplicates.length}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Pendientes de revisar después</span>
                <span className="font-mono text-lg font-semibold tabular-nums text-zinc-300">{bulkPreflight.reviewRequired.length}</span>
              </div>
              {bulkPreflight.blocked.length > 0 ? (
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Bloqueados</span>
                  <span className="font-mono text-lg font-semibold tabular-nums text-[#e3e3ea]">{bulkPreflight.blocked.length}</span>
                </div>
              ) : null}
            </div>
            {bulkPreflightIssues.length > 0 ? (
              <div className="max-h-64 overflow-auto rounded-xl border border-white/7">
                {bulkPreflightIssues.slice(0, 8).map((candidate) => (
                  <div key={`${candidate.tone}-${candidate.id}`} className="border-b border-white/7 p-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{candidate.tone}</Badge>
                      <span className="text-sm font-medium">{formatPreflightCandidate(candidate)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{candidate.reason}</p>
                  </div>
                ))}
                {bulkPreflightIssues.length > 8 ? (
                  <div className="p-3 text-xs text-muted-foreground">
                    Y {bulkPreflightIssues.length - 8} observaciones mas.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-[#cdfa46]/20 bg-[#cdfa46]/10 p-3 text-sm text-[#cdfa46]">
                No hay duplicados ni bloqueos detectados para este lote.
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Se crean solo los movimientos listos. Puedes deshacer pendientes después con “Omitir lote”.
            </p>
          </FinanceDialogBody>
        ) : null}
        <FinanceDialogFooter>
          <AlertDialogCancel
            className="border-white/10 bg-[#15151c] text-[#f4f4f7] hover:bg-[#22222b]"
            disabled={bulkConvertMutation.isPending}
          >
            Atrás
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-[#cdfa46] text-[#0a0a0f] hover:bg-[#cdfa46]"
            onClick={(event) => {
              event.preventDefault();
              void handleConfirmBulkConvert();
            }}
            disabled={!bulkPreflight?.ready || bulkConvertMutation.isPending}
          >
            {bulkConvertMutation.isPending ? "Aplicando..." : "Aplicar importación"}
          </AlertDialogAction>
        </FinanceDialogFooter>
      </FinanceAlertDialogContent>
    </AlertDialog>
    </>
  );
}
