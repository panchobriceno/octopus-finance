import { useMemo, useState } from "react";
import { useClientPayments, useTransactions } from "@/lib/hooks";
import { formatCLP, getMonthName } from "@/lib/utils";
import {
  combineFinancialTransactions,
  getTransactionExpenseImpact,
  getTransactionIncomeImpact,
  isExecutedTransaction,
  isPlannedTransaction,
  normalizeTransaction,
  type WorkspaceFilter,
} from "@/lib/finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, TrendingDown, TrendingUp } from "lucide-react";

interface CellTotals {
  real: number;
  planned: number;
}

function PnlCell({ value }: { value: CellTotals }) {
  const variance = value.real - value.planned;

  return (
    <div className="space-y-1 text-right">
      <div className="tabular-nums text-sm">{formatCLP(value.real)}</div>
      <div className="tabular-nums text-xs text-muted-foreground">
        Presup. {formatCLP(value.planned)}
      </div>
      <div
        className={`tabular-nums text-xs font-medium ${
          variance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
        }`}
      >
        Var. {formatCLP(variance)}
      </div>
    </div>
  );
}

export default function PnLPage() {
  const { data: transactions = [], isLoading: txLoading } = useTransactions();
  const { data: clientPayments = [] } = useClientPayments();
  const [workspace, setWorkspace] = useState<WorkspaceFilter>("all");
  const financialTransactions = useMemo(
    () => combineFinancialTransactions(transactions, clientPayments),
    [transactions, clientPayments],
  );

  const model = useMemo(() => {
    const scoped = financialTransactions.filter((tx) => workspace === "all" || normalizeTransaction(tx).workspace === workspace);
    const monthKeys = Array.from(new Set(scoped.map((tx) => tx.date.slice(0, 7)))).sort();
    const incomeCategories = new Set<string>();
    const expenseCategories = new Set<string>();
    const bucket: Record<string, Record<string, CellTotals>> = {};
    const monthStatus: Record<string, { real: boolean; planned: boolean }> = {};

    for (const monthKey of monthKeys) {
      monthStatus[monthKey] = { real: false, planned: false };
      bucket[monthKey] = {};
    }

    for (const tx of scoped) {
      if (tx.status === "cancelled") continue;

      const monthKey = tx.date.slice(0, 7);
      if (!bucket[monthKey]) {
        bucket[monthKey] = {};
        monthStatus[monthKey] = { real: false, planned: false };
      }

      if (!bucket[monthKey][tx.category]) {
        bucket[monthKey][tx.category] = { real: 0, planned: 0 };
      }

      if (getTransactionIncomeImpact(tx, workspace) > 0) {
        incomeCategories.add(tx.category);
      }

      if (getTransactionExpenseImpact(tx, workspace) > 0) {
        expenseCategories.add(tx.category);
      }

      if (isExecutedTransaction(tx)) {
        bucket[monthKey][tx.category].real += getTransactionIncomeImpact(tx, workspace) + getTransactionExpenseImpact(tx, workspace);
        monthStatus[monthKey].real = true;
      } else if (isPlannedTransaction(tx)) {
        bucket[monthKey][tx.category].planned += getTransactionIncomeImpact(tx, workspace) + getTransactionExpenseImpact(tx, workspace);
        monthStatus[monthKey].planned = true;
      }
    }

    const getRow = (category: string, type: "income" | "expense") => {
      const values = monthKeys.map((monthKey) => bucket[monthKey]?.[category] ?? { real: 0, planned: 0 });
      const total = values.reduce(
        (acc, value) => ({
          real: acc.real + value.real,
          planned: acc.planned + value.planned,
        }),
        { real: 0, planned: 0 },
      );

      return { category, type, values, total };
    };

    const incomeRows = Array.from(incomeCategories).sort().map((category) => getRow(category, "income"));
    const expenseRows = Array.from(expenseCategories).sort().map((category) => getRow(category, "expense"));

    const incomeTotalsByMonth = monthKeys.map((monthKey) =>
      incomeRows.reduce(
        (acc, row) => ({
          real: acc.real + (bucket[monthKey]?.[row.category]?.real ?? 0),
          planned: acc.planned + (bucket[monthKey]?.[row.category]?.planned ?? 0),
        }),
        { real: 0, planned: 0 },
      ));

    const expenseTotalsByMonth = monthKeys.map((monthKey) =>
      expenseRows.reduce(
        (acc, row) => ({
          real: acc.real + (bucket[monthKey]?.[row.category]?.real ?? 0),
          planned: acc.planned + (bucket[monthKey]?.[row.category]?.planned ?? 0),
        }),
        { real: 0, planned: 0 },
      ));

    const netTotalsByMonth = monthKeys.map((_, index) => ({
      real: incomeTotalsByMonth[index].real - expenseTotalsByMonth[index].real,
      planned: incomeTotalsByMonth[index].planned - expenseTotalsByMonth[index].planned,
    }));

    const grandIncome = incomeTotalsByMonth.reduce(
      (acc, value) => ({ real: acc.real + value.real, planned: acc.planned + value.planned }),
      { real: 0, planned: 0 },
    );
    const grandExpense = expenseTotalsByMonth.reduce(
      (acc, value) => ({ real: acc.real + value.real, planned: acc.planned + value.planned }),
      { real: 0, planned: 0 },
    );
    const grandNet = {
      real: grandIncome.real - grandExpense.real,
      planned: grandIncome.planned - grandExpense.planned,
    };

    return {
      monthKeys,
      monthStatus,
      incomeRows,
      expenseRows,
      incomeTotalsByMonth,
      expenseTotalsByMonth,
      netTotalsByMonth,
      grandIncome,
      grandExpense,
      grandNet,
    };
  }, [financialTransactions, workspace]);

  if (txLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <FileText className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Estado de Resultados</h2>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Ámbito:</span>
            <Select value={workspace} onValueChange={(value) => setWorkspace(value as WorkspaceFilter)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Consolidado</SelectItem>
                <SelectItem value="business">Empresa</SelectItem>
                <SelectItem value="family">Familia</SelectItem>
                <SelectItem value="dentist">Consulta Dentista</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="size-4 text-emerald-500" />
              <p className="text-sm text-muted-foreground">Total Ingresos Reales</p>
            </div>
            <p className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCLP(model.grandIncome.real)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Presupuestado: {formatCLP(model.grandIncome.planned)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="size-4 text-red-500" />
              <p className="text-sm text-muted-foreground">Total Gastos Reales</p>
            </div>
            <p className="text-xl font-semibold tabular-nums text-red-600 dark:text-red-400">
              {formatCLP(model.grandExpense.real)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Presupuestado: {formatCLP(model.grandExpense.planned)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="size-4 text-blue-500" />
              <p className="text-sm text-muted-foreground">Resultado Neto</p>
            </div>
            <p
              className={`text-xl font-semibold tabular-nums ${
                model.grandNet.real >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {formatCLP(model.grandNet.real)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Presupuestado: {formatCLP(model.grandNet.planned)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Vista Multi-mes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-muted-foreground">
              <span className="size-2 rounded-full bg-secondary-foreground/70" />
              Real
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-muted-foreground">
              <span className="size-2 rounded-full border border-muted-foreground" />
              Presupuestado
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-amber-50/60 px-3 py-1 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
              <span className="size-2 rounded-full bg-amber-500" />
              Mes con datos mixtos
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table data-testid="table-pnl">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5 min-w-[220px]">Categoría</TableHead>
                  {model.monthKeys.map((monthKey) => {
                    const [year, month] = monthKey.split("-");
                    const label = `${getMonthName(Number(month) - 1).slice(0, 3)} ${year}`;
                    const status = model.monthStatus[monthKey];

                    return (
                      <TableHead key={monthKey} className="min-w-[160px] text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span>{label}</span>
                          {status.real && !status.planned && <Badge variant="secondary" className="text-[10px]">Real</Badge>}
                          {!status.real && status.planned && <Badge variant="outline" className="text-[10px]">Solo proyección</Badge>}
                          {status.real && status.planned && (
                            <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              Mixto
                            </Badge>
                          )}
                        </div>
                      </TableHead>
                    );
                  })}
                  <TableHead className="min-w-[160px] text-right pr-5">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-emerald-50/50 dark:bg-emerald-950/20">
                  <TableCell className="pl-5 font-semibold text-sm text-emerald-700 dark:text-emerald-400">
                    Ingresos
                  </TableCell>
                  {model.monthKeys.map((monthKey) => (
                    <TableCell key={`income-spacer-${monthKey}`} />
                  ))}
                  <TableCell className="pr-5" />
                </TableRow>

                {model.incomeRows.map((row) => (
                  <TableRow key={`income-${row.category}`}>
                    <TableCell className="pl-5 text-sm font-medium">{row.category}</TableCell>
                    {row.values.map((value, index) => (
                      <TableCell key={`${row.category}-${model.monthKeys[index]}`} className="align-top">
                        <PnlCell value={value} />
                      </TableCell>
                    ))}
                    <TableCell className="pr-5 align-top">
                      <PnlCell value={row.total} />
                    </TableCell>
                  </TableRow>
                ))}

                <TableRow className="border-t border-border bg-emerald-50/30 dark:bg-emerald-950/10">
                  <TableCell className="pl-5 font-semibold text-sm">Total Ingresos</TableCell>
                  {model.incomeTotalsByMonth.map((value, index) => (
                    <TableCell key={`income-total-${model.monthKeys[index]}`}>
                      <PnlCell value={value} />
                    </TableCell>
                  ))}
                  <TableCell className="pr-5">
                    <PnlCell value={model.grandIncome} />
                  </TableCell>
                </TableRow>

                <TableRow className="bg-red-50/50 dark:bg-red-950/20">
                  <TableCell className="pl-5 font-semibold text-sm text-red-700 dark:text-red-400">
                    Gastos
                  </TableCell>
                  {model.monthKeys.map((monthKey) => (
                    <TableCell key={`expense-spacer-${monthKey}`} />
                  ))}
                  <TableCell className="pr-5" />
                </TableRow>

                {model.expenseRows.map((row) => (
                  <TableRow key={`expense-${row.category}`}>
                    <TableCell className="pl-5 text-sm font-medium">{row.category}</TableCell>
                    {row.values.map((value, index) => (
                      <TableCell key={`${row.category}-${model.monthKeys[index]}`} className="align-top">
                        <PnlCell value={value} />
                      </TableCell>
                    ))}
                    <TableCell className="pr-5 align-top">
                      <PnlCell value={row.total} />
                    </TableCell>
                  </TableRow>
                ))}

                <TableRow className="border-t border-border bg-red-50/30 dark:bg-red-950/10">
                  <TableCell className="pl-5 font-semibold text-sm">Total Gastos</TableCell>
                  {model.expenseTotalsByMonth.map((value, index) => (
                    <TableCell key={`expense-total-${model.monthKeys[index]}`}>
                      <PnlCell value={value} />
                    </TableCell>
                  ))}
                  <TableCell className="pr-5">
                    <PnlCell value={model.grandExpense} />
                  </TableCell>
                </TableRow>

                <TableRow className="border-t-2 border-border bg-muted/40">
                  <TableCell className="pl-5 font-semibold text-sm">Resultado Neto</TableCell>
                  {model.netTotalsByMonth.map((value, index) => (
                    <TableCell key={`net-total-${model.monthKeys[index]}`}>
                      <PnlCell value={value} />
                    </TableCell>
                  ))}
                  <TableCell className="pr-5">
                    <PnlCell value={model.grandNet} />
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
