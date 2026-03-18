import { useTransactions, useCategories } from "@/lib/hooks";
import { formatCLP } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { FileText, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from "recharts";

export default function PnLPage() {
  const { data: transactions = [], isLoading: txLoading } = useTransactions();
  const { data: categories = [] } = useCategories();

  // Group by category
  const incomeByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};

  for (const tx of transactions) {
    if (tx.type === "income") {
      incomeByCategory[tx.category] = (incomeByCategory[tx.category] || 0) + tx.amount;
    } else {
      expenseByCategory[tx.category] = (expenseByCategory[tx.category] || 0) + tx.amount;
    }
  }

  const totalIncome = Object.values(incomeByCategory).reduce((s, v) => s + v, 0);
  const totalExpenses = Object.values(expenseByCategory).reduce((s, v) => s + v, 0);
  const netResult = totalIncome - totalExpenses;

  const incomeEntries = Object.entries(incomeByCategory).sort(([, a], [, b]) => b - a);
  const expenseEntries = Object.entries(expenseByCategory).sort(([, a], [, b]) => b - a);

  // Pie chart data
  const getCategoryColor = (name: string) => {
    const cat = categories.find((c) => c.name === name);
    return cat?.color || "#64748b";
  };

  const expensePieData = expenseEntries.map(([name, value]) => ({
    name,
    value,
    color: getCategoryColor(name),
  }));

  const incomePieData = incomeEntries.map(([name, value]) => ({
    name,
    value,
    color: getCategoryColor(name),
  }));

  if (txLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-80 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <FileText className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Estado de Resultados</h2>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="size-4 text-emerald-500" />
              <p className="text-sm text-muted-foreground">Total Ingresos</p>
            </div>
            <p className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCLP(totalIncome)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="size-4 text-red-500" />
              <p className="text-sm text-muted-foreground">Total Gastos</p>
            </div>
            <p className="text-xl font-semibold tabular-nums text-red-600 dark:text-red-400">
              {formatCLP(totalExpenses)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 px-5">
            <div className="flex items-center gap-2 mb-1">
              <Minus className="size-4 text-blue-500" />
              <p className="text-sm text-muted-foreground">Resultado Neto</p>
            </div>
            <p
              className={`text-xl font-semibold tabular-nums ${
                netResult >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {formatCLP(netResult)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pie Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              Distribución de Ingresos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64" data-testid="chart-income-pie">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={incomePieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {incomePieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCLP(value)}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "13px",
                    }}
                  />
                  <Legend
                    formatter={(value) => (
                      <span className="text-xs text-foreground">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              Distribución de Gastos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64" data-testid="chart-expense-pie">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={expensePieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {expensePieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCLP(value)}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "13px",
                    }}
                  />
                  <Legend
                    formatter={(value) => (
                      <span className="text-xs text-foreground">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* P&L Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Detalle por Categoría
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table data-testid="table-pnl">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Categoría</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right pr-5">% del Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Income Section */}
              <TableRow className="bg-emerald-50/50 dark:bg-emerald-950/20">
                <TableCell className="pl-5 font-semibold text-sm text-emerald-700 dark:text-emerald-400" colSpan={3}>
                  Ingresos
                </TableCell>
              </TableRow>
              {incomeEntries.map(([name, amount]) => (
                <TableRow key={`inc-${name}`}>
                  <TableCell className="pl-8 text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: getCategoryColor(name) }}
                      />
                      {name}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-emerald-600 dark:text-emerald-400">
                    {formatCLP(amount)}
                  </TableCell>
                  <TableCell className="text-right pr-5 tabular-nums text-sm text-muted-foreground">
                    {totalIncome > 0 ? ((amount / totalIncome) * 100).toFixed(1) : 0}%
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t border-border">
                <TableCell className="pl-5 font-semibold text-sm">
                  Total Ingresos
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatCLP(totalIncome)}
                </TableCell>
                <TableCell className="text-right pr-5 tabular-nums text-sm font-semibold">
                  100%
                </TableCell>
              </TableRow>

              {/* Spacer */}
              <TableRow>
                <TableCell colSpan={3} className="h-2 p-0" />
              </TableRow>

              {/* Expense Section */}
              <TableRow className="bg-red-50/50 dark:bg-red-950/20">
                <TableCell className="pl-5 font-semibold text-sm text-red-700 dark:text-red-400" colSpan={3}>
                  Gastos
                </TableCell>
              </TableRow>
              {expenseEntries.map(([name, amount]) => (
                <TableRow key={`exp-${name}`}>
                  <TableCell className="pl-8 text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: getCategoryColor(name) }}
                      />
                      {name}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-red-600 dark:text-red-400">
                    {formatCLP(amount)}
                  </TableCell>
                  <TableCell className="text-right pr-5 tabular-nums text-sm text-muted-foreground">
                    {totalExpenses > 0 ? ((amount / totalExpenses) * 100).toFixed(1) : 0}%
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t border-border">
                <TableCell className="pl-5 font-semibold text-sm">
                  Total Gastos
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm font-semibold text-red-600 dark:text-red-400">
                  {formatCLP(totalExpenses)}
                </TableCell>
                <TableCell className="text-right pr-5 tabular-nums text-sm font-semibold">
                  100%
                </TableCell>
              </TableRow>

              {/* Net Result */}
              <TableRow>
                <TableCell colSpan={3} className="h-2 p-0" />
              </TableRow>
              <TableRow className="border-t-2 border-border bg-muted/30">
                <TableCell className="pl-5 font-bold text-sm">
                  Resultado Neto
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums text-sm font-bold ${
                    netResult >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatCLP(netResult)}
                </TableCell>
                <TableCell className="text-right pr-5 tabular-nums text-sm font-bold text-muted-foreground">
                  {totalIncome > 0 ? ((netResult / totalIncome) * 100).toFixed(1) : 0}%
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
