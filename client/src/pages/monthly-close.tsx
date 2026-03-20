import { useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCLP } from "@/lib/utils";
import { useBudgets, useCategories, useClientPayments, useTransactions } from "@/lib/hooks";
import { getTransactionExpenseImpact, isExecutedTransaction, normalizeTransaction, summarizeClientPaymentsByMonth } from "@/lib/finance";
import type { Budget, Category } from "@shared/schema";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type CloseWorkspace = "business" | "family";

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

    if (exact) return sum + exact.amount;

    const historical = budgets
      .filter(
        (budget) =>
          budget.categoryGroup === group &&
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

export default function MonthlyClosePage() {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  const { data: transactions = [], isLoading: txLoading } = useTransactions();
  const { data: clientPayments = [], isLoading: clientLoading } = useClientPayments();
  const { data: budgets = [], isLoading: budgetsLoading } = useBudgets();
  const { data: categories = [], isLoading: categoriesLoading } = useCategories();

  const selectedMonthKey = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;

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
  const businessRemainderBudget = businessIncome.net - businessBudget;
  const businessRemainderActual = businessIncome.net - businessActual;
  const familyIncomeTotalBudget = businessRemainderBudget + familyRealIncome;
  const familyIncomeTotalActual = businessRemainderActual + familyRealIncome;
  const familyBalanceBudget = familyIncomeTotalBudget - familyBudget;
  const familyBalanceActual = familyIncomeTotalActual - familyActual;

  const txYears = new Set(transactions.map((transaction) => parseInt(transaction.date.substring(0, 4), 10)));
  txYears.add(now.getFullYear());
  const years = Array.from(txYears).sort();

  const isLoading = txLoading || clientLoading || budgetsLoading || categoriesLoading;

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
      <div className="flex items-center gap-3">
        <ClipboardList className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Cierre Mensual</h2>
      </div>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Período:</span>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Ingresos clientes brutos</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{formatCLP(businessIncome.gross)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">IVA del mes</p>
            <p className="text-xl font-semibold tabular-nums mt-1 text-amber-700 dark:text-amber-300">{formatCLP(businessIncome.vat)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Remanente empresa real</p>
            <p className={`text-xl font-semibold tabular-nums mt-1 ${businessRemainderActual >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {formatCLP(businessRemainderActual)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Saldo familiar real</p>
            <p className={`text-xl font-semibold tabular-nums mt-1 ${familyBalanceActual >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {formatCLP(familyBalanceActual)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Resumen del cierre {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table className="zebra-stripe">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Concepto</TableHead>
                  <TableHead className="text-right">Presupuesto</TableHead>
                  <TableHead className="text-right pr-5">Real</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="pl-5 font-medium text-sm">Ingreso neto empresa</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{formatCLP(businessIncome.net)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm pr-5">{formatCLP(businessIncome.net)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-5 font-medium text-sm">Gastos empresa</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{formatCLP(businessBudget)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm pr-5">{formatCLP(businessActual)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-5 font-medium text-sm">Remanente empresa</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{formatCLP(businessRemainderBudget)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm pr-5">{formatCLP(businessRemainderActual)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-5 font-medium text-sm">Ingresos familia reales</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{formatCLP(familyRealIncome)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm pr-5">{formatCLP(familyRealIncome)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-5 font-medium text-sm">Ingreso familiar total</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{formatCLP(familyIncomeTotalBudget)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm pr-5">{formatCLP(familyIncomeTotalActual)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-5 font-medium text-sm">Gastos familia</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{formatCLP(familyBudget)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm pr-5">{formatCLP(familyActual)}</TableCell>
                </TableRow>
                <TableRow className="border-t-2 font-semibold">
                  <TableCell className="pl-5 text-sm">Saldo familiar</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    <Badge className={`text-xs ${familyBalanceBudget >= 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                      {formatCLP(familyBalanceBudget)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm pr-5">
                    <Badge className={`text-xs ${familyBalanceActual >= 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                      {formatCLP(familyBalanceActual)}
                    </Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
