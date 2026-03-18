import { useState, useMemo, useEffect } from "react";
import {
  useTransactions,
  useBudgets,
  useCategories,
  useItems,
  useCreateBudget,
  useUpdateBudget,
} from "@/lib/hooks";
import { formatCLP } from "@/lib/utils";
import type { Transaction, Budget, Category, Item } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Calculator, Save, TrendingUp, TrendingDown, Target } from "lucide-react";

// ── Month names ──────────────────────────────────────────────────
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// ── Component ────────────────────────────────────────────────────
export default function BudgetPage() {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-indexed

  // Local input state for each group's budget amount (keyed by category name)
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: transactions = [], isLoading: txLoading } = useTransactions();
  const { data: allBudgets = [], isLoading: budgetLoading } = useBudgets();
  const { data: categories = [], isLoading: catLoading } = useCategories();
  const { data: items = [] } = useItems();

  const createBudgetMutation = useCreateBudget();
  const updateBudgetMutation = useUpdateBudget();

  // ── Derive group names from categories (expense-only for budgeting) ──
  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === "expense"),
    [categories]
  );
  const groupNames = useMemo(
    () => expenseCategories.map((c) => c.name),
    [expenseCategories]
  );

  // Build reverse maps for item→category resolution
  const categoryByName = useMemo(() => {
    const map: Record<string, Category> = {};
    for (const cat of categories) {
      map[cat.name] = cat;
    }
    return map;
  }, [categories]);

  const categoryById = useMemo(() => {
    const map: Record<string, Category> = {};
    for (const cat of categories) {
      map[cat.id] = cat;
    }
    return map;
  }, [categories]);

  const itemById = useMemo(() => {
    const map: Record<string, Item> = {};
    for (const item of items) {
      map[item.id] = item;
    }
    return map;
  }, [items]);

  /** Map a transaction to its category group. */
  const getGroupForTransaction = useMemo(() => {
    return (tx: Transaction): string => {
      if (tx.itemId) {
        const item = itemById[tx.itemId];
        if (item?.categoryId) {
          const cat = categoryById[item.categoryId];
          if (cat && cat.type === "expense") return cat.name;
        }
      }
      const cat = categoryByName[tx.category];
      if (cat && cat.type === "expense") return cat.name;
      return "Sin Agrupadora";
    };
  }, [itemById, categoryById, categoryByName]);

  // Filter budgets for selected period
  const periodBudgets = useMemo(
    () => allBudgets.filter((b) => b.year === selectedYear && b.month === selectedMonth),
    [allBudgets, selectedYear, selectedMonth]
  );

  // Build map: group name → Budget record for this period
  const budgetByGroup = useMemo(() => {
    const map: Record<string, Budget> = {};
    for (const b of periodBudgets) {
      map[b.categoryGroup] = b;
    }
    return map;
  }, [periodBudgets]);

  // Sync input values when period or budgets change
  useEffect(() => {
    const vals: Record<string, string> = {};
    for (const group of groupNames) {
      const existing = budgetByGroup[group];
      vals[group] = existing ? String(existing.amount) : "";
    }
    setInputValues(vals);
  }, [budgetByGroup, groupNames]);

  // Filter transactions: subtype = "actual", expense, matching year/month
  const periodTransactions = useMemo(() => {
    const prefix = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
    return transactions.filter(
      (tx) =>
        tx.subtype === "actual" &&
        tx.type === "expense" &&
        tx.date.startsWith(prefix)
    );
  }, [transactions, selectedYear, selectedMonth]);

  // Calculate actuals per group
  const actualByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const group of groupNames) {
      map[group] = 0;
    }
    map["Sin Agrupadora"] = 0;

    for (const tx of periodTransactions) {
      const group = getGroupForTransaction(tx);
      map[group] = (map[group] ?? 0) + tx.amount;
    }
    return map;
  }, [periodTransactions, groupNames, getGroupForTransaction]);

  // Totals
  const totalBudget = groupNames.reduce(
    (sum, g) => sum + (budgetByGroup[g]?.amount ?? 0),
    0
  );
  const totalActual = groupNames.reduce(
    (sum, g) => sum + (actualByGroup[g] ?? 0),
    0
  );
  const totalDiff = totalBudget - totalActual;

  const handleSave = async (groupName: string) => {
    const rawValue = inputValues[groupName];
    const amount = parseFloat(rawValue || "0");
    if (isNaN(amount) || amount < 0) return;

    setSavingGroup(groupName);

    try {
      const existing = budgetByGroup[groupName];
      if (existing) {
        await updateBudgetMutation.mutateAsync({ id: existing.id, data: { amount } });
      } else {
        await createBudgetMutation.mutateAsync({
          year: selectedYear,
          month: selectedMonth,
          categoryGroup: groupName,
          amount,
        });
      }
      toast({
        title: "Presupuesto guardado",
        description: `${groupName}: ${formatCLP(amount)} para ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`,
      });
    } catch {
      toast({
        title: "Error",
        description: "No se pudo guardar el presupuesto.",
        variant: "destructive",
      });
    } finally {
      setSavingGroup(null);
    }
  };

  const isLoading = txLoading || budgetLoading || catLoading;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }

  // Available years based on transaction data
  const txYears = new Set(transactions.map((t) => parseInt(t.date.substring(0, 4))));
  txYears.add(now.getFullYear());
  const years = Array.from(txYears).sort();

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">Presupuesto Mensual</h2>
        </div>
      </div>

      {/* Period Selector */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Período:</span>
            <Select
              value={String(selectedMonth)}
              onValueChange={(v) => setSelectedMonth(parseInt(v))}
            >
              <SelectTrigger className="w-40" data-testid="select-budget-month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(selectedYear)}
              onValueChange={(v) => setSelectedYear(parseInt(v))}
            >
              <SelectTrigger className="w-28" data-testid="select-budget-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* KPI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Presupuesto Total</p>
                <p className="text-xl font-semibold tabular-nums mt-1">{formatCLP(totalBudget)}</p>
              </div>
              <div className="p-2.5 rounded-lg" style={{ backgroundColor: "#3b82f615" }}>
                <Calculator className="size-5" style={{ color: "#3b82f6" }} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Real Ejecutado</p>
                <p className="text-xl font-semibold tabular-nums mt-1">{formatCLP(totalActual)}</p>
              </div>
              <div className="p-2.5 rounded-lg" style={{ backgroundColor: "#f9731615" }}>
                <TrendingDown className="size-5" style={{ color: "#f97316" }} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Diferencia</p>
                <p className={`text-xl font-semibold tabular-nums mt-1 ${totalDiff >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {formatCLP(totalDiff)}
                </p>
              </div>
              <div
                className="p-2.5 rounded-lg"
                style={{ backgroundColor: totalDiff >= 0 ? "#10b98115" : "#ef444415" }}
              >
                <TrendingUp className="size-5" style={{ color: totalDiff >= 0 ? "#10b981" : "#ef4444" }} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Budget Editor */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Calculator className="size-4" />
            Definir Presupuesto — {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table data-testid="table-budget-editor">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Categoría Agrupadora</TableHead>
                  <TableHead className="w-48">Presupuesto (CLP)</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupNames.map((group) => (
                  <TableRow key={group}>
                    <TableCell className="pl-5 font-medium text-sm">{group}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step="1000"
                        placeholder="0"
                        className="h-8 w-44 tabular-nums"
                        value={inputValues[group] ?? ""}
                        onChange={(e) =>
                          setInputValues((prev) => ({ ...prev, [group]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave(group);
                        }}
                        data-testid={`input-budget-${group.replace(/\s+/g, "-").toLowerCase()}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => handleSave(group)}
                        disabled={savingGroup === group}
                        data-testid={`button-save-${group.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        <Save className="size-3.5" />
                        {savingGroup === group ? "..." : "Guardar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Comparison Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Presupuesto vs Real — {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table className="zebra-stripe" data-testid="table-budget-comparison">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Categoría Agrupadora</TableHead>
                  <TableHead className="text-right">Presupuesto</TableHead>
                  <TableHead className="text-right">Real Ejecutado</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead className="text-right pr-5">Ejecución</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupNames.map((group) => {
                  const budget = budgetByGroup[group]?.amount ?? 0;
                  const actual = actualByGroup[group] ?? 0;
                  const diff = budget - actual;
                  const pct = budget > 0 ? (actual / budget) * 100 : actual > 0 ? 999 : 0;

                  return (
                    <TableRow key={group} data-testid={`row-comparison-${group.replace(/\s+/g, "-").toLowerCase()}`}>
                      <TableCell className="pl-5 font-medium text-sm">{group}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {budget > 0 ? formatCLP(budget) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {actual > 0 ? formatCLP(actual) : <span className="text-muted-foreground">$0</span>}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums text-sm font-medium ${
                          diff >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {budget > 0 || actual > 0 ? formatCLP(diff) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right pr-5">
                        {budget > 0 ? (
                          <Badge
                            className={`text-xs ${
                              pct <= 100
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            }`}
                          >
                            {pct.toFixed(0)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Unmatched row */}
                {(actualByGroup["Sin Agrupadora"] ?? 0) > 0 && (
                  <TableRow>
                    <TableCell className="pl-5 font-medium text-sm text-muted-foreground italic">
                      Sin Agrupadora
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatCLP(actualByGroup["Sin Agrupadora"])}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium text-red-600 dark:text-red-400">
                      {formatCLP(-actualByGroup["Sin Agrupadora"])}
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      <span className="text-xs text-muted-foreground">—</span>
                    </TableCell>
                  </TableRow>
                )}
                {/* Totals row */}
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="pl-5 text-sm">Total</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{formatCLP(totalBudget)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{formatCLP(totalActual)}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums text-sm ${
                      totalDiff >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {formatCLP(totalDiff)}
                  </TableCell>
                  <TableCell className="text-right pr-5">
                    {totalBudget > 0 && (
                      <Badge
                        className={`text-xs ${
                          totalActual / totalBudget <= 1
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {((totalActual / totalBudget) * 100).toFixed(0)}%
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Unmatched transactions detail */}
      {(actualByGroup["Sin Agrupadora"] ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-muted-foreground">
              Transacciones sin agrupadora asignada — {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table data-testid="table-unmatched">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Fecha</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right pr-5">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {periodTransactions
                    .filter((tx) => getGroupForTransaction(tx) === "Sin Agrupadora")
                    .map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="pl-5 tabular-nums text-sm">{tx.date}</TableCell>
                        <TableCell className="text-sm font-medium">{tx.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">{tx.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium text-red-600 dark:text-red-400 pr-5">
                          {formatCLP(tx.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
