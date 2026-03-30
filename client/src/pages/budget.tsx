import { useState, useMemo, useEffect, type ReactNode } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  useGenerateMonthlyRecurringTransactions,
} from "@/lib/hooks";
import { formatCLP } from "@/lib/utils";
import type { Transaction, Budget, Category, Item } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Calculator, GripVertical, Save, TrendingUp, TrendingDown, Target, Trash2 } from "lucide-react";
import { normalizeTransaction, summarizeClientPaymentsByMonth } from "@/lib/finance";
import { getFamilyIncomeJaviMap, setFamilyIncomeJavi } from "@/lib/family-income";

type BudgetWorkspace = "business" | "family";
const ITEM_BUDGET_PREFIX = "item:";

// ── Month names ──────────────────────────────────────────────────
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function getBudgetStateKey(monthKey: string, workspace: BudgetWorkspace, groupName: string) {
  return `${monthKey}::${workspace}::${groupName}`;
}

function getBudgetScopeKey(monthKey: string, workspace: BudgetWorkspace) {
  return `${monthKey}::${workspace}`;
}

function getItemBudgetKey(itemId: string) {
  return `${ITEM_BUDGET_PREFIX}${itemId}`;
}

function isItemBudgetKey(value: string) {
  return value.startsWith(ITEM_BUDGET_PREFIX);
}

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

  // If a category was created before we started assigning explicit workspaces,
  // keep it available in both views so it doesn't disappear from the budget UI.
  return true;
}

function SortableBudgetRow({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <TableRow
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.7 : 1,
      }}
    >
      {children}
      <TableCell className="text-right pr-5">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4 text-muted-foreground" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ── Component ────────────────────────────────────────────────────
export default function BudgetPage() {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-indexed
  const [selectedWorkspace, setSelectedWorkspace] = useState<BudgetWorkspace>("business");

  // Local input state for each group's budget amount (keyed by category name)
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [recurringValues, setRecurringValues] = useState<Record<string, boolean>>({});
  const [dayOfMonthValues, setDayOfMonthValues] = useState<Record<string, string>>({});
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [newBudgetCategory, setNewBudgetCategory] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [draftGroupMap, setDraftGroupMap] = useState<Record<string, string[]>>({});
  const [manualOrderMap, setManualOrderMap] = useState<Record<string, string[]>>({});
  const [removedGroupMap, setRemovedGroupMap] = useState<Record<string, string[]>>({});
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
  const generateRecurringMutation = useGenerateMonthlyRecurringTransactions();
  const [familyIncomeJaviMap, setFamilyIncomeJaviMap] = useState<Record<string, number>>({});

  const selectedMonthKey = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;
  const selectedScopeKey = getBudgetScopeKey(selectedMonthKey, selectedWorkspace);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setFamilyIncomeJaviMap(getFamilyIncomeJaviMap());
    sync();
    window.addEventListener("octopus-family-income-updated", sync);
    return () => window.removeEventListener("octopus-family-income-updated", sync);
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

  const workspaceBudgetItems = useMemo(() => {
    return items.filter((item) => {
      if (!item.categoryId) return false;
      const category = categoryById[item.categoryId];
      if (!category || category.type !== "expense") return false;
      return matchesWorkspace(category, selectedWorkspace);
    });
  }, [items, categoryById, selectedWorkspace]);

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
    const candidateGroups = new Set<string>([
      ...groupNames,
      ...periodBudgets.map((budget) => budget.categoryGroup),
      ...(draftGroupMap[selectedScopeKey] ?? []),
      ...(manualOrderMap[selectedScopeKey] ?? []),
    ]);

    for (const group of Array.from(candidateGroups)) {
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
  }, [allBudgets, budgetByGroup, draftGroupMap, groupNames, manualOrderMap, periodBudgets, selectedMonth, selectedScopeKey, selectedWorkspace, selectedYear]);

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
    const prefix = `${selectedMonthKey}::${selectedWorkspace}::`;
    const draftGroups = draftGroupMap[selectedScopeKey] ?? [];
    const removedGroups = new Set(removedGroupMap[selectedScopeKey] ?? []);

    for (const budget of periodBudgets) {
      if (removedGroups.has(budget.categoryGroup)) continue;
      names.add(budget.categoryGroup);
    }

    for (const group of draftGroups) {
      if (removedGroups.has(group)) continue;
      names.add(group);
    }

    for (const [stateKey, value] of Object.entries(inputValues)) {
      if (!stateKey.startsWith(prefix)) continue;
      const group = stateKey.slice(prefix.length);
      if (removedGroups.has(group)) continue;
      if (value !== "" || names.has(group)) {
        names.add(group);
      }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [draftGroupMap, inputValues, periodBudgets, removedGroupMap, selectedMonthKey, selectedScopeKey, selectedWorkspace]);

  const orderedVisibleGroupNames = useMemo(() => {
    const manualOrder = manualOrderMap[selectedScopeKey];
    if (manualOrder?.length) {
      const inManualOrder = manualOrder.filter((group) => visibleGroupNames.includes(group));
      const missing = visibleGroupNames.filter((group) => !inManualOrder.includes(group));
      return [...inManualOrder, ...missing];
    }

    return [...visibleGroupNames].sort((left, right) => {
      const leftOrder = effectiveBudgetByGroup[left]?.order;
      const rightOrder = effectiveBudgetByGroup[right]?.order;

      if (leftOrder != null && rightOrder != null && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (leftOrder != null && rightOrder == null) return -1;
      if (leftOrder == null && rightOrder != null) return 1;
      return left.localeCompare(right);
    });
  }, [effectiveBudgetByGroup, manualOrderMap, selectedScopeKey, visibleGroupNames]);

  const sortableIdByGroup = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of orderedVisibleGroupNames) {
      const budget = budgetByGroup[group] ?? effectiveBudgetByGroup[group];
      map.set(group, budget?.id ?? `draft:${group}`);
    }
    return map;
  }, [budgetByGroup, effectiveBudgetByGroup, orderedVisibleGroupNames]);

  const groupBySortableId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [group, sortableId] of Array.from(sortableIdByGroup.entries())) {
      map.set(sortableId, group);
    }
    return map;
  }, [sortableIdByGroup]);

  const sortableBudgetRowIds = useMemo(
    () => orderedVisibleGroupNames.map((group) => sortableIdByGroup.get(group) ?? `draft:${group}`),
    [orderedVisibleGroupNames, sortableIdByGroup],
  );

  const availableCategoryOptions = useMemo(
    () => [
      ...expenseCategories
        .filter((category) => matchesWorkspace(category, selectedWorkspace))
        .map((category) => ({
          value: category.name,
          label: category.name,
        })),
      ...workspaceBudgetItems.map((item) => ({
        value: getItemBudgetKey(item.id),
        label: `${item.name} · ${categoryById[item.categoryId!]?.name ?? "Sin categoría"}`,
      })),
    ]
      .filter((option) => !visibleGroupNames.includes(option.value))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [categoryById, expenseCategories, selectedWorkspace, visibleGroupNames, workspaceBudgetItems],
  );

  // Sync input values when period or budgets change
  useEffect(() => {
    const vals: Record<string, string> = {};
    const recurring: Record<string, boolean> = {};
    const days: Record<string, string> = {};
    for (const group of orderedVisibleGroupNames) {
      const stateKey = getBudgetStateKey(selectedMonthKey, selectedWorkspace, group);
      const existing = effectiveBudgetByGroup[group];
      vals[stateKey] = existing ? String(existing.amount) : "";
      recurring[stateKey] = Boolean(existing?.isRecurring);
      days[stateKey] = existing?.dayOfMonth ? String(existing.dayOfMonth) : "";
    }
    setInputValues((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(vals)) {
        if (next[key] === undefined) {
          next[key] = value;
        }
      }
      return next;
    });
    setRecurringValues((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(recurring)) {
        if (next[key] === undefined) {
          next[key] = value;
        }
      }
      return next;
    });
    setDayOfMonthValues((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(days)) {
        if (next[key] === undefined) {
          next[key] = value;
        }
      }
      return next;
    });
  }, [effectiveBudgetByGroup, orderedVisibleGroupNames, selectedMonthKey, selectedWorkspace]);

  // Calculate actuals per group
  const actualByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    const visibleItemBudgetIds = new Set(
      orderedVisibleGroupNames
        .filter(isItemBudgetKey)
        .map((group) => group.replace(ITEM_BUDGET_PREFIX, "")),
    );
    for (const group of orderedVisibleGroupNames) {
      map[group] = 0;
    }
    map["Sin Agrupadora"] = 0;

    for (const tx of periodTransactions) {
      const itemGroup = tx.itemId ? getItemBudgetKey(tx.itemId) : null;
      let group = getGroupForTransaction(tx);

      if (itemGroup && map[itemGroup] !== undefined) {
        group = itemGroup;
      } else if (tx.itemId && visibleItemBudgetIds.has(tx.itemId)) {
        continue;
      }

      map[group] = (map[group] ?? 0) + tx.amount;
    }
    return map;
  }, [orderedVisibleGroupNames, periodTransactions, getGroupForTransaction]);

  const getVisibleBudgetAmount = (group: string) => {
    const raw = inputValues[getBudgetStateKey(selectedMonthKey, selectedWorkspace, group)];
    if (raw !== undefined && raw !== "") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return effectiveBudgetByGroup[group]?.amount ?? 0;
  };

  const getBudgetEntryLabel = (group: string) => {
    if (!isItemBudgetKey(group)) return group;
    const itemId = group.replace(ITEM_BUDGET_PREFIX, "");
    return itemById[itemId]?.name ?? group;
  };

  const getBudgetEntryMeta = (group: string) => {
    if (!isItemBudgetKey(group)) return null;
    const itemId = group.replace(ITEM_BUDGET_PREFIX, "");
    const item = itemById[itemId];
    if (!item?.categoryId) return "Subcategoría";
    return categoryById[item.categoryId]?.name ?? "Subcategoría";
  };

  // Totals
  const totalBudget = orderedVisibleGroupNames.reduce((sum, g) => sum + getVisibleBudgetAmount(g), 0);
  const totalActual = orderedVisibleGroupNames.reduce(
    (sum, g) => sum + (actualByGroup[g] ?? 0),
    0
  );
  const totalDiff = totalBudget - totalActual;

  const handleSave = async (groupName: string) => {
    const stateKey = getBudgetStateKey(selectedMonthKey, selectedWorkspace, groupName);
    const rawValue = inputValues[stateKey];
    const amount = parseFloat(rawValue || "0");
    if (isNaN(amount) || amount < 0) return;
    const order = orderedVisibleGroupNames.indexOf(groupName);

    setSavingGroup(groupName);

    try {
      const existing = budgetByGroup[groupName];
      if (existing) {
        await updateBudgetMutation.mutateAsync({
          id: existing.id,
          data: {
            amount,
            isRecurring: recurringValues[stateKey] ?? false,
            dayOfMonth: recurringValues[stateKey]
              ? Math.max(1, Math.min(31, Number(dayOfMonthValues[stateKey] || 1)))
              : null,
            order,
          },
        });
      } else {
        await createBudgetMutation.mutateAsync({
          year: selectedYear,
          month: selectedMonth,
          categoryGroup: groupName,
          amount,
          workspace: selectedWorkspace,
          isRecurring: recurringValues[stateKey] ?? false,
          dayOfMonth: recurringValues[stateKey]
            ? Math.max(1, Math.min(31, Number(dayOfMonthValues[stateKey] || 1)))
            : null,
          order,
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
    const relevantBudgets = allBudgets
      .filter(
        (budget) =>
          (budget.workspace ?? "business") === workspace &&
          (budget.year < selectedYear ||
            (budget.year === selectedYear && budget.month <= selectedMonth)),
      )
      .sort((left, right) => {
        if (left.categoryGroup !== right.categoryGroup) {
          return left.categoryGroup.localeCompare(right.categoryGroup);
        }
        if (left.year !== right.year) return right.year - left.year;
        return right.month - left.month;
      });

    const latestByGroup = new Map<string, Budget>();
    for (const budget of relevantBudgets) {
      if (!latestByGroup.has(budget.categoryGroup)) {
        latestByGroup.set(budget.categoryGroup, budget);
      }
    }

    return Array.from(latestByGroup.values()).reduce((sum, budget) => sum + budget.amount, 0);
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
    const stateKey = getBudgetStateKey(selectedMonthKey, selectedWorkspace, newBudgetCategory);
    setInputValues((current) => ({
      ...current,
      [stateKey]: current[stateKey] ?? "0",
    }));
    setRecurringValues((current) => ({
      ...current,
      [stateKey]: current[stateKey] ?? false,
    }));
    setDayOfMonthValues((current) => ({
      ...current,
      [stateKey]: current[stateKey] ?? "",
    }));
    setDraftGroupMap((current) => ({
      ...current,
      [selectedScopeKey]: [...(current[selectedScopeKey] ?? []), newBudgetCategory],
    }));
    setManualOrderMap((current) => ({
      ...current,
      [selectedScopeKey]: [...orderedVisibleGroupNames, newBudgetCategory],
    }));
    setRemovedGroupMap((current) => ({
      ...current,
      [selectedScopeKey]: (current[selectedScopeKey] ?? []).filter((name) => name !== newBudgetCategory),
    }));
    setNewBudgetCategory("");
  };

  const handleCreateCategoryFromBudget = async () => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) return;
    const stateKey = getBudgetStateKey(selectedMonthKey, selectedWorkspace, trimmedName);

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
      [stateKey]: current[stateKey] ?? "0",
    }));
    setRecurringValues((current) => ({
      ...current,
      [stateKey]: current[stateKey] ?? false,
    }));
    setDayOfMonthValues((current) => ({
      ...current,
      [stateKey]: current[stateKey] ?? "",
    }));
    setDraftGroupMap((current) => ({
      ...current,
      [selectedScopeKey]: [...(current[selectedScopeKey] ?? []), trimmedName],
    }));
    setManualOrderMap((current) => ({
      ...current,
      [selectedScopeKey]: [...orderedVisibleGroupNames, trimmedName],
    }));
    setRemovedGroupMap((current) => ({
      ...current,
      [selectedScopeKey]: (current[selectedScopeKey] ?? []).filter((name) => name !== trimmedName),
    }));
    setNewCategoryName("");
    toast({
      title: alreadyExists ? "Categoría agregada al presupuesto" : "Categoría creada",
      description: trimmedName,
    });
  };

  const handleRemoveBudgetCategory = async (groupName: string) => {
    const stateKey = getBudgetStateKey(selectedMonthKey, selectedWorkspace, groupName);
    const existing = budgetByGroup[groupName];
    setRemovedGroupMap((current) => ({
      ...current,
      [selectedScopeKey]: Array.from(new Set([...(current[selectedScopeKey] ?? []), groupName])),
    }));

    try {
      if (existing) {
        await deleteBudgetMutation.mutateAsync(existing.id);
      }
    } catch {
      setRemovedGroupMap((current) => ({
        ...current,
        [selectedScopeKey]: (current[selectedScopeKey] ?? []).filter((name) => name !== groupName),
      }));
      toast({
        title: "Error",
        description: "No se pudo quitar la categoría del presupuesto.",
        variant: "destructive",
      });
      return;
    }

    setInputValues((current) => {
      const next = { ...current };
      delete next[stateKey];
      return next;
    });
    setRecurringValues((current) => {
      const next = { ...current };
      delete next[stateKey];
      return next;
    });
    setDayOfMonthValues((current) => {
      const next = { ...current };
      delete next[stateKey];
      return next;
    });
    setDraftGroupMap((current) => ({
      ...current,
      [selectedScopeKey]: (current[selectedScopeKey] ?? []).filter((name) => name !== groupName),
    }));
    setManualOrderMap((current) => ({
      ...current,
      [selectedScopeKey]: orderedVisibleGroupNames.filter((name) => name !== groupName),
    }));

    toast({
      title: "Categoría quitada del presupuesto",
      description: groupName,
    });
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const currentOrder = [...orderedVisibleGroupNames];
    const activeGroup = groupBySortableId.get(String(active.id));
    const overGroup = groupBySortableId.get(String(over.id));
    if (!activeGroup || !overGroup) return;

    const oldIndex = currentOrder.indexOf(activeGroup);
    const newIndex = currentOrder.indexOf(overGroup);
    if (oldIndex === -1 || newIndex === -1) return;

    const nextOrder = arrayMove(currentOrder, oldIndex, newIndex);
    setManualOrderMap((current) => ({ ...current, [selectedScopeKey]: nextOrder }));

    try {
      await Promise.all(
        nextOrder.map((group, index) => {
          const budget = budgetByGroup[group] ?? effectiveBudgetByGroup[group];
          if (!budget?.id) return Promise.resolve();
          return updateBudgetMutation.mutateAsync({
            id: budget.id,
            data: { order: index },
          });
        }),
      );
    } catch {
      toast({
        title: "No se pudo guardar el nuevo orden",
        description: "El orden visual no se pudo persistir. Intenta de nuevo.",
        variant: "destructive",
      });
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
              <p className="text-xs text-muted-foreground">Agregar categoría o subcategoría al presupuesto</p>
              <Select value={newBudgetCategory} onValueChange={setNewBudgetCategory}>
                <SelectTrigger data-testid="select-add-budget-category">
                  <SelectValue placeholder="Elegir categoría o subcategoría" />
                </SelectTrigger>
                <SelectContent>
                  {availableCategoryOptions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No hay más opciones disponibles
                    </div>
                  ) : (
                    availableCategoryOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
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

          <div className="px-5">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                generateRecurringMutation.mutate(
                  { year: selectedYear, month: selectedMonth, workspace: selectedWorkspace },
                  {
                    onSuccess: (result) => {
                      toast({
                        title: "Compromisos generados",
                        description: result.created > 0
                          ? `${result.created} compromiso(s) creados para el mes`
                          : "No había compromisos nuevos por crear",
                      });
                    },
                  },
                )
              }
              disabled={generateRecurringMutation.isPending}
              data-testid="button-generate-recurring-transactions"
            >
              {generateRecurringMutation.isPending ? "Generando..." : "Generar compromisos del mes"}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table className="zebra-stripe" data-testid="table-budget-comparison">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Categoría Agrupadora</TableHead>
                  <TableHead className="w-44">Presupuesto</TableHead>
                  <TableHead className="text-center">Recurrente</TableHead>
                  <TableHead className="w-32">Día de pago</TableHead>
                  <TableHead className="text-right">Real Ejecutado</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead className="text-right">Ejecución</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                  <TableHead className="text-right pr-5">Orden</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={sortableBudgetRowIds} strategy={verticalListSortingStrategy}>
                {orderedVisibleGroupNames.map((group) => {
                  const stateKey = getBudgetStateKey(selectedMonthKey, selectedWorkspace, group);
                  const budget = getVisibleBudgetAmount(group);
                  const actual = actualByGroup[group] ?? 0;
                  const diff = budget - actual;
                  const pct = budget > 0 ? (actual / budget) * 100 : actual > 0 ? 999 : 0;
                  const carriedForward =
                    !budgetByGroup[group] &&
                    Boolean(effectiveBudgetByGroup[group]) &&
                    selectedMonth !== (effectiveBudgetByGroup[group]?.month ?? selectedMonth);

                  return (
                    <SortableBudgetRow key={group} id={sortableIdByGroup.get(group) ?? `draft:${group}`}>
                      <TableCell className="pl-5">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{getBudgetEntryLabel(group)}</span>
                            {isItemBudgetKey(group) ? (
                              <Badge variant="outline" className="text-[10px]">Subcategoría</Badge>
                            ) : null}
                          </div>
                          {getBudgetEntryMeta(group) ? (
                            <p className="text-[11px] text-muted-foreground">{getBudgetEntryMeta(group)}</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Input
                            type="number"
                            min="0"
                            step="1000"
                            placeholder="0"
                            className="h-8 w-36 tabular-nums"
                            value={inputValues[stateKey] ?? ""}
                            onChange={(e) =>
                              setInputValues((prev) => ({ ...prev, [stateKey]: e.target.value }))
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
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <Switch
                            checked={recurringValues[stateKey] ?? false}
                            onCheckedChange={(checked) =>
                              setRecurringValues((prev) => ({ ...prev, [stateKey]: checked }))
                            }
                            data-testid={`switch-recurring-${group.replace(/\s+/g, "-").toLowerCase()}`}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        {(recurringValues[stateKey] ?? false) ? (
                          <Input
                            type="number"
                            min="1"
                            max="31"
                            placeholder="Día"
                            className="h-8 w-24"
                            value={dayOfMonthValues[stateKey] ?? ""}
                            onChange={(e) =>
                              setDayOfMonthValues((prev) => ({ ...prev, [stateKey]: e.target.value }))
                            }
                            data-testid={`input-day-of-month-${group.replace(/\s+/g, "-").toLowerCase()}`}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
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
                    </SortableBudgetRow>
                  );
                })}
                  </SortableContext>
                </DndContext>
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="pl-5 text-sm">{selectedWorkspace === "family" ? "Subtotal" : "Total"}</TableCell>
                  <TableCell className="tabular-nums text-sm">{formatCLP(totalBudget)}</TableCell>
                  <TableCell />
                  <TableCell />
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
                  <TableCell />
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
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right tabular-nums text-sm">{formatCLP(familyIncomeJavi)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-blue-700 dark:text-blue-300">
                        {formatCLP(familyIncomeJavi)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          Ingreso
                        </Badge>
                      </TableCell>
                      <TableCell />
                      <TableCell className="pr-5" />
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-5 font-medium text-sm">Ingreso Agencia</TableCell>
                      <TableCell className="tabular-nums text-sm">{formatCLP(businessRemainder)}</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right tabular-nums text-sm">{formatCLP(businessRemainder)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-blue-700 dark:text-blue-300">
                        {formatCLP(businessRemainder)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          Ingreso
                        </Badge>
                      </TableCell>
                      <TableCell />
                      <TableCell className="pr-5" />
                    </TableRow>
                    <TableRow className="font-semibold">
                      <TableCell className="pl-5 text-sm">Total ingresos</TableCell>
                      <TableCell className="tabular-nums text-sm">{formatCLP(familyIncomeTotal)}</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right tabular-nums text-sm">{formatCLP(familyIncomeTotal)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-blue-700 dark:text-blue-300">
                        {formatCLP(familyIncomeTotal)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          Ingreso
                        </Badge>
                      </TableCell>
                      <TableCell />
                      <TableCell className="pr-5" />
                    </TableRow>
                    <TableRow className="font-semibold">
                      <TableCell className="pl-5 text-sm">Saldo</TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {formatCLP(familyBalanceAfterBudget)}
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right tabular-nums text-sm">{formatCLP(totalActual)}</TableCell>
                      <TableCell className={`text-right tabular-nums text-sm ${familyBalanceAfterBudget >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {formatCLP(familyBalanceAfterBudget)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className={`text-xs ${familyBalanceAfterBudget >= 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                          {familyBalanceAfterBudget >= 0 ? "A favor" : "Negativo"}
                        </Badge>
                      </TableCell>
                      <TableCell />
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
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatCLP(actualByGroup["Sin Agrupadora"])}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium text-red-600 dark:text-red-400">
                      {formatCLP(-actualByGroup["Sin Agrupadora"])}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-xs text-muted-foreground">—</span>
                    </TableCell>
                    <TableCell />
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
