import { useState, useMemo } from "react";
import { formatCLP, formatDate } from "@/lib/utils";
import {
  useTransactions,
  useCategories,
  useItems,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useBulkDeleteTransactions,
} from "@/lib/hooks";
import type { Transaction, Category, Item } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  DollarSign, TrendingUp, TrendingDown, Wallet, Plus, Trash2, Pencil, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { buildMonthlySummaries, getCurrentMonthKey } from "@/lib/finance";
import { getMonthlyBalances, useOpeningBalance } from "@/lib/monthly-balances";

// ── KPI Card ────────────────────────────────────────────────────
function KPICard({
  title,
  value,
  icon: Icon,
  trend,
  color,
}: {
  title: string;
  value: string;
  icon: any;
  trend?: string;
  color: string;
}) {
  return (
    <Card data-testid={`kpi-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{value}</p>
            {trend && (
              <p className="text-xs text-muted-foreground mt-1">{trend}</p>
            )}
          </div>
          <div
            className="p-2.5 rounded-lg"
            style={{ backgroundColor: `${color}15` }}
          >
            <Icon className="size-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Transaction Form (shared between create & edit) ─────────────
interface TransactionFormProps {
  mode: "create" | "edit";
  categories: Category[];
  items: Item[];
  initialValues?: {
    type: "income" | "expense";
    categoryId: string;
    itemId: string;
    amount: string;
    date: string;
    subtype: "actual" | "planned";
    status: "pending" | "paid" | "cancelled";
    notes: string;
  };
  isPending: boolean;
  onSubmit: (data: {
    type: "income" | "expense";
    categoryId: string;
    itemId: string;
    amount: string;
    date: string;
    subtype: "actual" | "planned";
    status: "pending" | "paid" | "cancelled";
    notes: string;
  }) => void;
  onCancel?: () => void;
}

function TransactionForm({
  mode,
  categories,
  items,
  initialValues,
  isPending,
  onSubmit,
  onCancel,
}: TransactionFormProps) {
  const defaults = initialValues ?? {
    type: "income" as const,
    categoryId: "",
    itemId: "",
    amount: "",
    date: new Date().toISOString().split("T")[0],
    subtype: "actual" as const,
    status: "paid" as const,
    notes: "",
  };

  const [formType, setFormType] = useState(defaults.type);
  const [formCategoryId, setFormCategoryId] = useState(defaults.categoryId);
  const [formItemId, setFormItemId] = useState(defaults.itemId);
  const [formAmount, setFormAmount] = useState(defaults.amount);
  const [formDate, setFormDate] = useState(defaults.date);
  const [formSubtype, setFormSubtype] = useState(defaults.subtype);
  const [formStatus, setFormStatus] = useState(defaults.status);
  const [formNotes, setFormNotes] = useState(defaults.notes);

  const filteredCategories = categories.filter((c) => c.type === formType);
  const filteredItems = items.filter((i) => i.categoryId === formCategoryId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCategoryId || !formAmount) return;
    onSubmit({
      type: formType,
      categoryId: formCategoryId,
      itemId: formItemId,
      amount: formAmount,
      date: formDate,
      subtype: formSubtype,
      status: formStatus,
      notes: formNotes,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Row 1 */}
      <div>
        <Select
          value={formType}
          onValueChange={(v) => {
            setFormType(v as "income" | "expense");
            setFormCategoryId("");
            setFormItemId("");
          }}
        >
          <SelectTrigger data-testid="select-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="income">Ingreso</SelectItem>
            <SelectItem value="expense">Gasto</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Select
          value={formCategoryId}
          onValueChange={(v) => {
            setFormCategoryId(v);
            setFormItemId("");
          }}
        >
          <SelectTrigger data-testid="select-category">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            {filteredCategories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Select
          value={formItemId}
          onValueChange={setFormItemId}
          disabled={!formCategoryId}
        >
          <SelectTrigger data-testid="select-subcategory">
            <SelectValue placeholder={formCategoryId ? "Subcategoría (opcional)" : "Elegir categoría primero"} />
          </SelectTrigger>
          <SelectContent>
            {filteredItems.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
            {filteredItems.length === 0 && formCategoryId && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No hay subcategorías para esta categoría
              </div>
            )}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Input
          type="number"
          placeholder="Monto"
          value={formAmount}
          onChange={(e) => setFormAmount(e.target.value)}
          data-testid="input-amount"
        />
      </div>

      {/* Row 2 */}
      <div>
        <Input
          type="date"
          value={formDate}
          onChange={(e) => setFormDate(e.target.value)}
          data-testid="input-date"
        />
      </div>

      <div>
        <Select value={formSubtype} onValueChange={(v) => setFormSubtype(v as "actual" | "planned")}>
          <SelectTrigger data-testid="select-subtype">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="actual">Ejecutado</SelectItem>
            <SelectItem value="planned">Presupuestado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Select value={formStatus} onValueChange={(v) => setFormStatus(v as "pending" | "paid" | "cancelled")}>
          <SelectTrigger data-testid="select-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pendiente</SelectItem>
            <SelectItem value="paid">Pagado</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        {mode === "create" ? (
          <Button
            type="submit"
            className="w-full"
            disabled={isPending}
            data-testid="button-add-transaction"
          >
            {isPending ? "Guardando..." : "Agregar"}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              type="submit"
              className="flex-1"
              disabled={isPending}
              data-testid="button-save-transaction"
            >
              {isPending ? "Guardando..." : "Guardar"}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-edit">
                <X className="size-4" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Row 3 — Notes (full width) */}
      <div className="sm:col-span-2 lg:col-span-4">
        <Textarea
          placeholder="Notas (opcional)"
          value={formNotes}
          onChange={(e) => setFormNotes(e.target.value)}
          rows={2}
          className="resize-none"
          data-testid="input-notes"
        />
      </div>
    </form>
  );
}

// ── Main Page ────────────────────────────────────────────────────
export default function OverviewPage() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const { toast } = useToast();

  const { data: transactions = [], isLoading: txLoading } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: items = [] } = useItems();
  const currentMonthKey = getCurrentMonthKey();
  const { amount: openingBalance, update: updateOpeningBalance } = useOpeningBalance(currentMonthKey);

  // Lookup maps
  const categoryMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const itemMap = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);

  // Reverse lookups: category name → id
  const categoryNameToId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) map[c.name] = c.id;
    return map;
  }, [categories]);

  // Visible transactions (limited to 50)
  const visibleTransactions = transactions.slice(0, 50);

  // ── Mutations ──
  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();
  const bulkDeleteMutation = useBulkDeleteTransactions();

  // ── KPI calculations ──
  const totalIncome = transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);
  const balance = totalIncome - totalExpenses;
  const currentMonthSummary = useMemo(() => {
    const openingBalances = {
      ...getMonthlyBalances(),
      [currentMonthKey]: openingBalance,
    };

    return buildMonthlySummaries(transactions, openingBalances).find(
      (summary) => summary.monthKey === currentMonthKey,
    ) ?? {
      monthKey: currentMonthKey,
      label: "",
      openingBalance,
      realIncome: 0,
      realExpenses: 0,
      plannedIncome: 0,
      plannedExpenses: 0,
      realEndingBalance: openingBalance,
      projectedEndingBalance: openingBalance,
      hasRealData: false,
      hasPlannedData: false,
    };
  }, [transactions, currentMonthKey, openingBalance]);

  // Monthly chart data
  const chartData = useMemo(() => {
    const monthlyData: Record<string, { month: string; ingresos: number; gastos: number }> = {};
    for (const tx of transactions) {
      const month = tx.date.substring(0, 7);
      if (!monthlyData[month]) {
        const [y, m] = month.split("-");
        const monthNames = [
          "Ene", "Feb", "Mar", "Abr", "May", "Jun",
          "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
        ];
        monthlyData[month] = {
          month: `${monthNames[parseInt(m) - 1]} ${y}`,
          ingresos: 0,
          gastos: 0,
        };
      }
      if (tx.type === "income") {
        monthlyData[month].ingresos += tx.amount;
      } else {
        monthlyData[month].gastos += tx.amount;
      }
    }
    return Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [transactions]);

  // ── Selection logic ──
  const visibleIds = visibleTransactions.map((t) => t.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ── Form handlers ──
  const handleCreate = (formData: {
    type: "income" | "expense";
    categoryId: string;
    itemId: string;
    amount: string;
    date: string;
    subtype: "actual" | "planned";
    status: "pending" | "paid" | "cancelled";
    notes: string;
  }) => {
    const selectedCategory = categoryMap[formData.categoryId];
    const selectedItem = formData.itemId ? itemMap[formData.itemId] : null;
    createMutation.mutate(
      {
        name: selectedItem?.name ?? selectedCategory?.name ?? "",
        category: selectedCategory?.name ?? "",
        amount: parseFloat(formData.amount),
        type: formData.type,
        date: formData.date,
        notes: formData.notes || null,
        subtype: formData.subtype,
        status: formData.status,
        itemId: formData.itemId || null,
      },
      {
        onSuccess: () => toast({ title: "Transacción creada" }),
      }
    );
  };

  const handleEdit = (formData: {
    type: "income" | "expense";
    categoryId: string;
    itemId: string;
    amount: string;
    date: string;
    subtype: "actual" | "planned";
    status: "pending" | "paid" | "cancelled";
    notes: string;
  }) => {
    if (!editingTx) return;
    const selectedCategory = categoryMap[formData.categoryId];
    const selectedItem = formData.itemId ? itemMap[formData.itemId] : null;
    updateMutation.mutate(
      {
        id: editingTx.id,
        data: {
          name: selectedItem?.name ?? selectedCategory?.name ?? "",
          category: selectedCategory?.name ?? "",
          amount: parseFloat(formData.amount),
          type: formData.type,
          date: formData.date,
          notes: formData.notes || null,
          subtype: formData.subtype,
          status: formData.status,
          itemId: formData.itemId || null,
        },
      },
      {
        onSuccess: () => {
          setEditingTx(null);
          toast({ title: "Transacción actualizada" });
        },
      }
    );
  };

  // Resolve a transaction to initial form values for editing
  const getEditValues = (tx: Transaction) => {
    const catId = categoryNameToId[tx.category] ?? "";
    const itmId = tx.itemId ?? "";
    return {
      type: tx.type as "income" | "expense",
      categoryId: catId,
      itemId: itmId,
      amount: String(tx.amount),
      date: tx.date,
      subtype: tx.subtype as "actual" | "planned",
      status: tx.status as "pending" | "paid" | "cancelled",
      notes: tx.notes ?? "",
    };
  };

  if (txLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Balance"
          value={formatCLP(balance)}
          icon={Wallet}
          color={balance >= 0 ? "#10b981" : "#ef4444"}
          trend={`${transactions.length} transacciones`}
        />
        <KPICard
          title="Ingresos"
          value={formatCLP(totalIncome)}
          icon={TrendingUp}
          color="#10b981"
        />
        <KPICard
          title="Gastos"
          value={formatCLP(totalExpenses)}
          icon={TrendingDown}
          color="#ef4444"
        />
        <KPICard
          title="Margen"
          value={
            totalIncome > 0
              ? `${((balance / totalIncome) * 100).toFixed(1)}%`
              : "0%"
          }
          icon={DollarSign}
          color="#3b82f6"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Balance de Apertura y Proyección del Mes
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <div className="rounded-xl border border-blue-200/70 bg-blue-50/60 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
              Saldo inicial
            </p>
            <p className="text-xs text-muted-foreground mt-1 mb-3">
              Guardado por mes en este navegador
            </p>
            <Input
              type="number"
              value={String(openingBalance)}
              onChange={(e) => updateOpeningBalance(Number(e.target.value || 0))}
              data-testid="input-opening-balance"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Mes: {currentMonthKey}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">Ejecutado</p>
              <p className="text-lg font-semibold tabular-nums mt-1">
                {formatCLP(currentMonthSummary.realEndingBalance)}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {formatCLP(openingBalance)} + {formatCLP(currentMonthSummary.realIncome)} - {formatCLP(currentMonthSummary.realExpenses)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <p className="text-sm text-muted-foreground">Ingresos presupuestados</p>
              <p className="text-lg font-semibold tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
                {formatCLP(currentMonthSummary.plannedIncome)}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                No impactan el saldo real
              </p>
            </div>
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
              <p className="text-sm text-muted-foreground">Saldo proyectado</p>
              <p className="text-lg font-semibold tabular-nums mt-1 text-blue-700 dark:text-blue-300">
                {formatCLP(currentMonthSummary.projectedEndingBalance)}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Ejecutado + proyectado del resto del mes
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            Ingresos vs Gastos Mensuales
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72" data-testid="chart-monthly">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value: number) => formatCLP(value)}
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "13px",
                  }}
                />
                <Legend />
                <Bar
                  dataKey="ingresos"
                  name="Ingresos"
                  fill="hsl(var(--chart-1))"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="gastos"
                  name="Gastos"
                  fill="hsl(var(--chart-3))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Create Transaction Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Plus className="size-4" />
            Agregar Transacción
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionForm
            mode="create"
            categories={categories}
            items={items}
            isPending={createMutation.isPending}
            onSubmit={handleCreate}
          />
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Últimas Transacciones
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="mx-5 mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5" data-testid="bulk-action-bar">
              <span className="text-sm font-medium text-primary">
                {selectedIds.size} transacci{selectedIds.size === 1 ? "ón" : "ones"} seleccionada{selectedIds.size === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setSelectedIds(new Set())}
                  data-testid="button-clear-selection"
                >
                  Limpiar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowDeleteDialog(true)}
                  data-testid="button-bulk-delete"
                >
                  <Trash2 className="size-3.5" />
                  Eliminar seleccionadas
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table className="zebra-stripe" data-testid="table-transactions">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5 w-10">
                    <Checkbox
                      checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                      onCheckedChange={toggleSelectAll}
                      data-testid="checkbox-select-all"
                      aria-label="Seleccionar todas"
                    />
                  </TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Ejecutado/Presup.</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right pr-5">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTransactions.map((tx) => (
                  <TableRow
                    key={tx.id}
                    data-testid={`row-transaction-${tx.id}`}
                    className={selectedIds.has(tx.id) ? "bg-primary/5" : undefined}
                  >
                    <TableCell className="pl-5">
                      <Checkbox
                        checked={selectedIds.has(tx.id)}
                        onCheckedChange={() => toggleSelect(tx.id)}
                        data-testid={`checkbox-${tx.id}`}
                        aria-label={`Seleccionar ${tx.name}`}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {formatDate(tx.date)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {tx.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {tx.category}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={tx.subtype === "planned" ? "outline" : "secondary"}
                        className="text-xs"
                      >
                        {tx.subtype === "planned" ? "Presupuestado" : "Ejecutado"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${
                          tx.status === "paid"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : tx.status === "pending"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {tx.status === "paid" ? "Pagado" : tx.status === "pending" ? "Pendiente" : "Cancelado"}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums text-sm font-medium ${
                        tx.type === "income"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {tx.type === "income" ? "+" : "-"}
                      {formatCLP(tx.amount)}
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setEditingTx(tx)}
                          data-testid={`button-edit-${tx.id}`}
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => deleteMutation.mutate(tx.id)}
                          data-testid={`button-delete-${tx.id}`}
                        >
                          <Trash2 className="size-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar transacciones</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que quieres eliminar{" "}
              <span className="font-semibold text-foreground">{selectedIds.size}</span>{" "}
              transacci{selectedIds.size === 1 ? "ón" : "ones"}? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                bulkDeleteMutation.mutate(Array.from(selectedIds), {
                  onSuccess: (data) => {
                    setSelectedIds(new Set());
                    setShowDeleteDialog(false);
                    toast({ title: `${data.deleted} transacciones eliminadas` });
                  },
                })
              }
              disabled={bulkDeleteMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending ? "Eliminando..." : `Eliminar ${selectedIds.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Transaction Modal */}
      <Dialog open={!!editingTx} onOpenChange={(open) => { if (!open) setEditingTx(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Editar Transacción</DialogTitle>
            <DialogDescription>
              Modifica los campos y guarda los cambios.
            </DialogDescription>
          </DialogHeader>
          {editingTx && (
            <TransactionForm
              key={editingTx.id}
              mode="edit"
              categories={categories}
              items={items}
              initialValues={getEditValues(editingTx)}
              isPending={updateMutation.isPending}
              onSubmit={handleEdit}
              onCancel={() => setEditingTx(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
