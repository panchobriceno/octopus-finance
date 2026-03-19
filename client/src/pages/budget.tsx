import { useState, useMemo, useEffect } from "react";
import {
  useTransactions,
  useBudgets,
  useCategories,
  useItems,
  useClientPayments,
  useCreateBudget,
  useUpdateBudget,
  useDeleteBudget,
  useCreateCategory,
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
import { Calculator, Save, TrendingUp, TrendingDown, Target, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { normalizeTransaction, summarizeClientPaymentsByMonth } from "@/lib/finance";
import { getFamilyIncomeJaviMap, setFamilyIncomeJavi } from "@/lib/family-income";

type BudgetWorkspace = "business" | "family";
const BUDGET_ORDER_STORAGE_KEY = "octopus_budget_order";

// ── Month names ──────────────────────────────────────────────────
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function normalizeCategoryName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchesWorkspace(category: Category, workspace: BudgetWorkspace) {
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

// ── Component ────────────────────────────────────────────────────
export default function BudgetPage() {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-indexed
  const [selectedWorkspace, setSelectedWorkspace] = useState<BudgetWorkspace>("business");

  // Local input state for each group's budget amount (keyed by category name)
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [newBudgetCategory, setNewBudgetCategory] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [budgetOrderMap, setBudgetOrderMap] = useState<Record<string, string[]>>({});
  const { toast } = useToast();

  const { data: transactions = [], isLoading: txLoading } = useTransactions();
  const { data: clientPayments = [], isLoading: clientPaymentsLoading } = useClientPayments();
  const { data: allBudgets = [], isLoading: budgetLoading } = useBudgets();
  const { data: categories = [], isLoading: catLoading } = useCategories();
  const { data: items = [] } = useItems();

  const createBudgetMutation = useCreateBudget();
  const updateBudgetMutation = useUpdateBudget();
  const deleteBudgetMutation = useDeleteBudget();
  const createCategoryMutation = useCreateCategory();
  const [familyIncomeJaviMap, setFamilyIncomeJaviMap] = useState<Record<string, number>>({});

  const selectedMonthKey = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setFamilyIncomeJaviMap(getFamilyIncomeJaviMap());
    sync();
    window.addEventListener("octopus-family-income-updated", sync);
    return () => window.removeEventListener("octopus-family-income-updated", sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(BUDGET_ORDER_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      setBudgetOrderMap(parsed);
    } catch {
      setBudgetOrderMap({});
    }
  }, []);

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === "expense"),
    [categories]
  );
  const workspaceCategories = useMemo(() => {
    return expenseCategories.filter((category) => matchesWorkspace(category, selectedWorkspace));
  }, [expenseCategories, selectedWorkspace]);
  const groupNames = useMemo(
    () => workspaceCategories.map((c) => c.name),
    [workspaceCategories]
  );

  // Build reverse maps for item→category resolution
  const categoryByName = useMemo(() => {
    const map: Record<string, Category> = {};
    for (const cat of categories) {
      map[cat.name] = cat;
    }
    return map;
  }, [categories]);

  const categoryByNormalizedName = useMemo(() => {
    const map: Record<string, Category> = {};
    for (const cat of categories) {
      map[normalizeCategoryName(cat.name)] = cat;
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
      const cat =
        categoryByName[tx.category] ??
        categoryByNormalizedName[normalizeCategoryName(tx.category)];
      if (cat && cat.type === "expense") return cat.name;
      return "Sin Agrupadora";
    };
  }, [itemById, categoryById, categoryByName, categoryByNormalizedName]);

  // Filter budgets for selected period
  const periodBudgets = useMemo(
    () => allBudgets.filter(
      (b) =>
        b.year === selectedYear &&
        b.month === selectedMonth &&
        (b.workspace ?? "business") === selectedWorkspace
    ),
    [allBudgets, selectedYear, selectedMonth, selectedWorkspace]
  );

  // Build map: group name → Budget record for this period
  const budgetByGroup = useMemo(() => {
    const map: Record<string, Budget> = {};
    for (const b of periodBudgets) {
      map[b.categoryGroup] = b;
    }
    return map;
  }, [periodBudgets]);

  const effectiveBudgetByGroup = useMemo(() => {
    const map: Record<string, Budget | undefined> = {};

    for (const group of groupNames) {
      const exact = budgetByGroup[group];
      if (exact) {
        map[group] = exact;
        continue;
      }

      const historical = allBudgets
        .filter(
          (budget) =>
            budget.categoryGroup === group &&
            (budget.workspace ?? "business") === selectedWorkspace &&
            (budget.year < selectedYear ||
              (budget.year === selectedYear && budget.month < selectedMonth)),
        )
        .sort((left, right) => {
          if (left.year !== right.year) return right.year - left.year;
          return right.month - left.month;
        })[0];

      map[group] = historical;
    }

    return map;
  }, [allBudgets, budgetByGroup, groupNames, selectedMonth, selectedWorkspace, selectedYear]);

  // Filter transactions: subtype = "actual", expense, matching year/month
  const periodTransactions = useMemo(() => {
    const prefix = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
    return transactions.filter(
      (tx) => {
        const normalized = normalizeTransaction(tx);
        return (
          normalized.subtype === "actual" &&
          normalized.type === "expense" &&
          normalized.movementType === "expense" &&
          normalized.workspace === selectedWorkspace &&
          normalized.date.startsWith(prefix)
        );
      }
    );
  }, [transactions, selectedYear, selectedMonth, selectedWorkspace]);

  const visibleGroupNames = useMemo(() => {
    const names = new Set<string>();

    for (const budget of periodBudgets) {
      names.add(budget.categoryGroup);
    }

    for (const [group, value] of Object.entries(inputValues)) {
      if (value !== "" || names.has(group)) {
        names.add(group);
      }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [inputValues, periodBudgets]);

  const orderedVisibleGroupNames = useMemo(() => {
    const savedOrder = budgetOrderMap[selectedWorkspace] ?? [];
    const orderIndex = new Map(savedOrder.map((name, index) => [name, index]));

    return [...visibleGroupNames].sort((left, right) => {
      const leftIndex = orderIndex.get(left);
      const rightIndex = orderIndex.get(right);

      if (leftIndex === undefined && rightIndex === undefined) {
        return left.localeCompare(right);
      }
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      return leftIndex - rightIndex;
    });
  }, [budgetOrderMap, selectedWorkspace, visibleGroupNames]);

  const availableCategoryOptions = useMemo(
    () => expenseCategories
      .map((category) => category.name)
      .filter((name) => !visibleGroupNames.includes(name))
      .sort((a, b) => a.localeCompare(b)),
    [expenseCategories, visibleGroupNames],
  );

  // Sync input values when period or budgets change
  useEffect(() => {
    const vals: Record<string, string> = {};
    for (const group of orderedVisibleGroupNames) {
      const existing = effectiveBudgetByGroup[group];
      vals[group] = existing ? String(existing.amount) : "";
    }
    setInputValues((current) => ({ ...vals, ...current }));
  }, [effectiveBudgetByGroup, orderedVisibleGroupNames]);

  // Calculate actuals per group
  const actualByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const group of orderedVisibleGroupNames) {
      map[group] = 0;
    }
    map["Sin Agrupadora"] = 0;

    for (const tx of periodTransactions) {
      const group = getGroupForTransaction(tx);
      map[group] = (map[group] ?? 0) + tx.amount;
    }
    return map;
  }, [orderedVisibleGroupNames, periodTransactions, getGroupForTransaction]);

  const getVisibleBudgetAmount = (group: string) => {
    const raw = inputValues[group];
    if (raw !== undefined && raw !== "") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return effectiveBudgetByGroup[group]?.amount ?? 0;
  };

  // Totals
  const totalBudget = orderedVisibleGroupNames.reduce((sum, g) => sum + getVisibleBudgetAmount(g), 0);
  const totalActual = orderedVisibleGroupNames.reduce(
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
          workspace: selectedWorkspace,
        });
      }
      toast({
        title: "Presupuesto guardado",
        description: `${groupName}: ${formatCLP(amount)} para ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} (${selectedWorkspace === "business" ? "Empresa" : "Familia"})`,
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

  const isLoading = txLoading || budgetLoading || catLoading || clientPaymentsLoading;
  const clientPaymentsByMonth = useMemo(
    () => summarizeClientPaymentsByMonth(clientPayments),
    [clientPayments],
  );
  const businessIncomeSummary = clientPaymentsByMonth[selectedMonthKey] ?? {
    net: 0,
    vat: 0,
    gross: 0,
    paidNet: 0,
    paidVat: 0,
    paidGross: 0,
  };
  const familyIncomeJavi = familyIncomeJaviMap[selectedMonthKey] ?? 0;
  const getEffectiveBudgetTotalForWorkspace = (workspace: BudgetWorkspace) => {
    const names = expenseCategories
      .filter((category) => matchesWorkspace(category, workspace))
      .map((category) => category.name);

    return names.reduce((sum, group) => {
      const exact = allBudgets.find(
        (budget) =>
          budget.categoryGroup === group &&
          (budget.workspace ?? "business") === workspace &&
          budget.year === selectedYear &&
          budget.month === selectedMonth,
      );

      if (exact) return sum + exact.amount;

      const historical = allBudgets
        .filter(
          (budget) =>
            budget.categoryGroup === group &&
            (budget.workspace ?? "business") === workspace &&
            (budget.year < selectedYear ||
              (budget.year === selectedYear && budget.month < selectedMonth)),
        )
        .sort((left, right) => {
          if (left.year !== right.year) return right.year - left.year;
          return right.month - left.month;
        })[0];

      return sum + (historical?.amount ?? 0);
    }, 0);
  };
  const businessBudgetTotal = getEffectiveBudgetTotalForWorkspace("business");
  const familyBudgetTotal = getEffectiveBudgetTotalForWorkspace("family");
  const visibleBusinessBudgetTotal = selectedWorkspace === "business" ? totalBudget : businessBudgetTotal;
  const visibleFamilyBudgetTotal = selectedWorkspace === "family" ? totalBudget : familyBudgetTotal;
  const businessRemainder = businessIncomeSummary.net - visibleBusinessBudgetTotal;
  const familyIncomeTotal = businessRemainder + familyIncomeJavi;
  const familyBalanceAfterBudget = familyIncomeTotal - visibleFamilyBudgetTotal;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }

  const saveFamilyIncomeJavi = (value: number) => {
    const next = setFamilyIncomeJavi(selectedMonthKey, value);
    setFamilyIncomeJaviMap(next);
  };

  const handleAddBudgetCategory = () => {
    if (!newBudgetCategory) return;
    setInputValues((current) => ({
      ...current,
      [newBudgetCategory]: current[newBudgetCategory] ?? "0",
    }));
    const nextOrder = [...orderedVisibleGroupNames, newBudgetCategory];
    const nextMap = { ...budgetOrderMap, [selectedWorkspace]: nextOrder };
    setBudgetOrderMap(nextMap);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BUDGET_ORDER_STORAGE_KEY, JSON.stringify(nextMap));
    }
    setNewBudgetCategory("");
  };

  const handleCreateCategoryFromBudget = async () => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) return;

    const alreadyExists = expenseCategories.some(
      (category) => category.name.toLowerCase() === trimmedName.toLowerCase(),
    );

    if (!alreadyExists) {
      await createCategoryMutation.mutateAsync({
        name: trimmedName,
        type: "expense",
        color: "#64748b",
        workspace: selectedWorkspace,
      });
    }

    setInputValues((current) => ({
      ...current,
      [trimmedName]: current[trimmedName] ?? "0",
    }));
    setNewCategoryName("");
    toast({
      title: alreadyExists ? "Categoría agregada al presupuesto" : "Categoría creada",
      description: trimmedName,
    });
  };

  const handleRemoveBudgetCategory = async (groupName: string) => {
    const existing = budgetByGroup[groupName];
    if (existing) {
      await deleteBudgetMutation.mutateAsync(existing.id);
    }

    setInputValues((current) => {
      const next = { ...current };
      delete next[groupName];
      return next;
    });
    const nextOrder = orderedVisibleGroupNames.filter((name) => name !== groupName);
    const nextMap = { ...budgetOrderMap, [selectedWorkspace]: nextOrder };
    setBudgetOrderMap(nextMap);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BUDGET_ORDER_STORAGE_KEY, JSON.stringify(nextMap));
    }

    toast({
      title: "Categoría quitada del presupuesto",
      description: groupName,
    });
  };

  const handleMoveBudgetCategory = (groupName: string, direction: "up" | "down") => {
    const currentOrder = [...orderedVisibleGroupNames];
    const currentIndex = currentOrder.indexOf(groupName);
    if (currentIndex === -1) return;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= currentOrder.length) return;

    const [moved] = currentOrder.splice(currentIndex, 1);
    currentOrder.splice(targetIndex, 0, moved);

    const nextMap = { ...budgetOrderMap, [selectedWorkspace]: currentOrder };
    setBudgetOrderMap(nextMap);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BUDGET_ORDER_STORAGE_KEY, JSON.stringify(nextMap));
    }
  };

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
              value={selectedWorkspace}
              onValueChange={(v) => setSelectedWorkspace(v as BudgetWorkspace)}
            >
              <SelectTrigger className="w-40" data-testid="select-budget-workspace">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="business">Empresa</SelectItem>
                <SelectItem value="family">Familia</SelectItem>
              </SelectContent>
            </Select>
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
                <p className="text-xs text-muted-foreground mt-1">{selectedWorkspace === "business" ? "Empresa" : "Familia"}</p>
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
                <p className="text-xs text-muted-foreground mt-1">{selectedWorkspace === "business" ? "Empresa" : "Familia"}</p>
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
                <p className="text-xs text-muted-foreground mt-1">{selectedWorkspace === "business" ? "Empresa" : "Familia"}</p>
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Empresa: ingreso cliente a remanente
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Ingresos clientes brutos</p>
              <p className="text-lg font-semibold tabular-nums mt-1">{formatCLP(businessIncomeSummary.gross)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">IVA comprometido</p>
              <p className="text-lg font-semibold tabular-nums mt-1 text-amber-700 dark:text-amber-300">{formatCLP(businessIncomeSummary.vat)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Ingreso neto empresa</p>
              <p className="text-lg font-semibold tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">{formatCLP(businessIncomeSummary.net)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Remanente empresa</p>
              <p className={`text-lg font-semibold tabular-nums mt-1 ${businessRemainder >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {formatCLP(businessRemainder)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Ingreso neto menos presupuesto empresa</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Familia: ingreso disponible del mes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Ingreso agencia</p>
                <p className="text-lg font-semibold tabular-nums mt-1">{formatCLP(businessRemainder)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Ingreso Javi</p>
                <Input
                  type="number"
                  value={String(familyIncomeJavi)}
                  onChange={(e) => saveFamilyIncomeJavi(Number(e.target.value || 0))}
                  data-testid="input-family-income-javi"
                />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Ingreso familiar total</p>
                <p className="text-lg font-semibold tabular-nums mt-1 text-blue-700 dark:text-blue-300">{formatCLP(familyIncomeTotal)}</p>
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <p className="text-sm text-muted-foreground">Saldo familiar vs presupuesto</p>
              <p className={`text-lg font-semibold tabular-nums mt-1 ${familyBalanceAfterBudget >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {formatCLP(familyBalanceAfterBudget)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Ingreso agencia + ingreso Javi - presupuesto familia del mes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Presupuesto y ejecución {selectedWorkspace === "business" ? "Empresa" : "Familia"} — {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 space-y-4">
          <div className="px-5 grid gap-3 lg:grid-cols-[minmax(0,320px)_auto_minmax(0,320px)_auto] lg:items-end">
            <div className="w-full md:max-w-sm space-y-1.5">
              <p className="text-xs text-muted-foreground">Agregar categoría al presupuesto</p>
              <Select value={newBudgetCategory} onValueChange={setNewBudgetCategory}>
                <SelectTrigger data-testid="select-add-budget-category">
                  <SelectValue placeholder="Elegir categoría" />
                </SelectTrigger>
                <SelectContent>
                  {availableCategoryOptions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No hay más categorías disponibles
                    </div>
                  ) : (
                    availableCategoryOptions.map((categoryName) => (
                      <SelectItem key={categoryName} value={categoryName}>
                        {categoryName}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleAddBudgetCategory}
              disabled={!newBudgetCategory}
            >
              Agregar categoría
            </Button>
            <div className="w-full md:max-w-sm space-y-1.5">
              <p className="text-xs text-muted-foreground">Crear categoría nueva</p>
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="Nombre de la categoría"
                data-testid="input-new-budget-category-name"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleCreateCategoryFromBudget}
              disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
            >
              {createCategoryMutation.isPending ? "Creando..." : "Crear y agregar"}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table className="zebra-stripe" data-testid="table-budget-comparison">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Categoría Agrupadora</TableHead>
                  <TableHead className="w-44">Presupuesto</TableHead>
                  <TableHead className="text-right">Real Ejecutado</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead className="text-right">Ejecución</TableHead>
                  <TableHead className="text-right pr-5">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedVisibleGroupNames.map((group, index) => {
                  const budget = getVisibleBudgetAmount(group);
                  const actual = actualByGroup[group] ?? 0;
                  const diff = budget - actual;
                  const pct = budget > 0 ? (actual / budget) * 100 : actual > 0 ? 999 : 0;
                  const carriedForward =
                    !budgetByGroup[group] &&
                    Boolean(effectiveBudgetByGroup[group]) &&
                    selectedMonth !== (effectiveBudgetByGroup[group]?.month ?? selectedMonth);

                  return (
                    <TableRow key={group} data-testid={`row-comparison-${group.replace(/\s+/g, "-").toLowerCase()}`}>
                      <TableCell className="pl-5 font-medium text-sm">{group}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Input
                            type="number"
                            min="0"
                            step="1000"
                            placeholder="0"
                            className="h-8 w-36 tabular-nums"
                            value={inputValues[group] ?? ""}
                            onChange={(e) =>
                              setInputValues((prev) => ({ ...prev, [group]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSave(group);
                            }}
                            data-testid={`input-budget-${group.replace(/\s+/g, "-").toLowerCase()}`}
                          />
                          {carriedForward && (
                            <p className="text-[11px] text-muted-foreground">
                              Arrastrado desde {MONTH_NAMES[(effectiveBudgetByGroup[group]?.month ?? 1) - 1]} {effectiveBudgetByGroup[group]?.year}
                            </p>
                          )}
                        </div>
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
                      <TableCell className="text-right">
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
                      <TableCell className="text-right pr-5">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleMoveBudgetCategory(group, "up")}
                            disabled={index === 0}
                            data-testid={`button-move-up-${group.replace(/\s+/g, "-").toLowerCase()}`}
                          >
                            <ArrowUp className="size-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleMoveBudgetCategory(group, "down")}
                            disabled={index === orderedVisibleGroupNames.length - 1}
                            data-testid={`button-move-down-${group.replace(/\s+/g, "-").toLowerCase()}`}
                          >
                            <ArrowDown className="size-4 text-muted-foreground" />
                          </Button>
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
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleRemoveBudgetCategory(group)}
                            disabled={deleteBudgetMutation.isPending}
                            data-testid={`button-remove-${group.replace(/\s+/g, "-").toLowerCase()}`}
                          >
                            <Trash2 className="size-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="pl-5 text-sm">{selectedWorkspace === "family" ? "Subtotal" : "Total"}</TableCell>
                  <TableCell className="tabular-nums text-sm">{formatCLP(totalBudget)}</TableCell>
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
                  <TableCell className="text-right">
                    {totalBudget > 0 ? (
                      <Badge
                        className={`text-xs ${
                          totalActual / totalBudget <= 1
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {((totalActual / totalBudget) * 100).toFixed(0)}%
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5" />
                </TableRow>
                {selectedWorkspace === "family" && (
                  <>
                    <TableRow>
                      <TableCell className="pl-5 font-medium text-sm">Ingreso Javi</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="1000"
                          className="h-8 w-36 tabular-nums"
                          value={String(familyIncomeJavi)}
                          onChange={(e) => saveFamilyIncomeJavi(Number(e.target.value || 0))}
                          data-testid="input-budget-family-income-javi"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatCLP(familyIncomeJavi)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-blue-700 dark:text-blue-300">
                        {formatCLP(familyIncomeJavi)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          Ingreso
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-5" />
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-5 font-medium text-sm">Ingreso Agencia</TableCell>
                      <TableCell className="tabular-nums text-sm">{formatCLP(businessRemainder)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatCLP(businessRemainder)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-blue-700 dark:text-blue-300">
                        {formatCLP(businessRemainder)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          Ingreso
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-5" />
                    </TableRow>
                    <TableRow className="font-semibold">
                      <TableCell className="pl-5 text-sm">Total ingresos</TableCell>
                      <TableCell className="tabular-nums text-sm">{formatCLP(familyIncomeTotal)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatCLP(familyIncomeTotal)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-blue-700 dark:text-blue-300">
                        {formatCLP(familyIncomeTotal)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          Ingreso
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-5" />
                    </TableRow>
                    <TableRow className="font-semibold">
                      <TableCell className="pl-5 text-sm">Saldo</TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {formatCLP(familyBalanceAfterBudget)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatCLP(totalActual)}</TableCell>
                      <TableCell className={`text-right tabular-nums text-sm ${familyBalanceAfterBudget >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {formatCLP(familyBalanceAfterBudget)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className={`text-xs ${familyBalanceAfterBudget >= 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                          {familyBalanceAfterBudget >= 0 ? "A favor" : "Negativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-5" />
                    </TableRow>
                  </>
                )}
                {(actualByGroup["Sin Agrupadora"] ?? 0) > 0 && (
                  <TableRow>
                    <TableCell className="pl-5 font-medium text-sm text-muted-foreground italic">
                      Sin Agrupadora
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">Asigna ámbito y categoría.</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatCLP(actualByGroup["Sin Agrupadora"])}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium text-red-600 dark:text-red-400">
                      {formatCLP(-actualByGroup["Sin Agrupadora"])}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-xs text-muted-foreground">—</span>
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      <span className="text-xs text-muted-foreground">—</span>
                    </TableCell>
                  </TableRow>
                )}
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
              Transacciones sin agrupadora asignada ({selectedWorkspace === "business" ? "Empresa" : "Familia"}) — {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
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
