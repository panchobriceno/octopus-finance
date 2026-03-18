import { useMemo, useState } from "react";
import { useClientPayments, useTransactions } from "@/lib/hooks";
import { formatCLP } from "@/lib/utils";
import {
  buildDailyProjectionData,
  buildMonthlySummaries,
  combineFinancialTransactions,
  getCurrentMonthKey,
  summarizeWorkspaceTransactions,
  type WorkspaceFilter,
} from "@/lib/finance";
import { getMonthlyBalances, useOpeningBalance } from "@/lib/monthly-balances";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpDown } from "lucide-react";

export default function CashFlowPage() {
  const { data: transactions = [], isLoading } = useTransactions();
  const { data: clientPayments = [] } = useClientPayments();
  const currentMonthKey = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [workspace, setWorkspace] = useState<WorkspaceFilter>("all");
  const { amount: openingBalance, update: updateOpeningBalance } = useOpeningBalance(selectedMonth);
  const financialTransactions = useMemo(
    () => combineFinancialTransactions(transactions, clientPayments),
    [transactions, clientPayments],
  );

  const monthlySummaries = useMemo(() => {
    const openingBalances = {
      ...getMonthlyBalances(),
      [selectedMonth]: openingBalance,
    };
    return buildMonthlySummaries(financialTransactions, openingBalances, workspace);
  }, [financialTransactions, selectedMonth, openingBalance, workspace]);

  const workspaceMetrics = useMemo(
    () => summarizeWorkspaceTransactions(financialTransactions, workspace),
    [financialTransactions, workspace],
  );

  const availableMonths = useMemo(() => {
    const keys = new Set(monthlySummaries.map((summary) => summary.monthKey));
    keys.add(currentMonthKey);
    keys.add(selectedMonth);
    return Array.from(keys).sort();
  }, [monthlySummaries, currentMonthKey, selectedMonth]);

  const selectedSummary = monthlySummaries.find((summary) => summary.monthKey === selectedMonth) ?? {
    monthKey: selectedMonth,
    label: selectedMonth,
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

  const chartData = useMemo(
    () => buildDailyProjectionData(financialTransactions, selectedMonth, openingBalance, workspace),
    [financialTransactions, selectedMonth, openingBalance, workspace],
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <ArrowUpDown className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Flujo de Caja</h2>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Balance de Apertura y Vista del Mes
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[220px_220px_1fr]">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Ámbito</p>
            <Select value={workspace} onValueChange={(value) => setWorkspace(value as WorkspaceFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Consolidado</SelectItem>
                <SelectItem value="business">Empresa</SelectItem>
                <SelectItem value="family">Familia</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Mes</p>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger data-testid="select-cashflow-month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableMonths.map((monthKey) => (
                  <SelectItem key={monthKey} value={monthKey}>
                    {monthKey}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-2">Saldo inicial</p>
            <Input
              type="number"
              value={String(openingBalance)}
              onChange={(e) => updateOpeningBalance(Number(e.target.value || 0))}
              data-testid="input-cashflow-opening-balance"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Línea sólida: ejecutado</Badge>
            <Badge variant="outline">Línea punteada: proyectado</Badge>
            <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              Saldo final real: {formatCLP(selectedSummary.realEndingBalance)}
            </Badge>
            <Badge variant="outline">
              Saldo fin de mes proyectado: {formatCLP(selectedSummary.projectedEndingBalance)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Ejecutado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-2xl font-semibold tabular-nums">
              {formatCLP(selectedSummary.realEndingBalance)}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatCLP(selectedSummary.openingBalance)} + {formatCLP(selectedSummary.realIncome)} - {formatCLP(selectedSummary.realExpenses)}
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
              <div className="rounded-lg bg-emerald-50/60 p-3 dark:bg-emerald-950/20">
                <p className="text-muted-foreground">Ingresos reales</p>
                <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatCLP(selectedSummary.realIncome)}
                </p>
              </div>
              <div className="rounded-lg bg-red-50/60 p-3 dark:bg-red-950/20">
                <p className="text-muted-foreground">Gastos reales</p>
                <p className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                  {formatCLP(selectedSummary.realExpenses)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Proyectado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-2xl font-semibold tabular-nums text-blue-700 dark:text-blue-300">
              {formatCLP(selectedSummary.projectedEndingBalance)}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatCLP(selectedSummary.realEndingBalance)} + {formatCLP(selectedSummary.plannedIncome)} - {formatCLP(selectedSummary.plannedExpenses)}
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
              <div className="rounded-lg bg-emerald-50/60 p-3 dark:bg-emerald-950/20">
                <p className="text-muted-foreground">Ingresos presupuestados</p>
                <p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatCLP(selectedSummary.plannedIncome)}
                </p>
              </div>
              <div className="rounded-lg bg-amber-50/60 p-3 dark:bg-amber-950/20">
                <p className="text-muted-foreground">Gastos presupuestados</p>
                <p className="font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                  {formatCLP(selectedSummary.plannedExpenses)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {workspace !== "family" && (
        <Card>
          <CardContent className="pt-5 grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Deuda tarjeta</p>
              <p className="text-lg font-semibold tabular-nums mt-1">{formatCLP(workspaceMetrics.creditCardDebt)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Transferencias recibidas</p>
              <p className="text-lg font-semibold tabular-nums mt-1">{formatCLP(workspaceMetrics.transfersIn)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Transferencias enviadas</p>
              <p className="text-lg font-semibold tabular-nums mt-1">{formatCLP(workspaceMetrics.transfersOut)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            Saldo Diario Ejecutado vs Proyectado
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80" data-testid="chart-cashflow">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
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
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="realBalance"
                  name="Saldo ejecutado"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="projectedBalance"
                  name="Saldo proyectado"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2.5}
                  strokeDasharray="6 6"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Desglose Mensual
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table className="zebra-stripe" data-testid="table-cashflow">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Mes</TableHead>
                  <TableHead className="text-right">Saldo inicial</TableHead>
                  <TableHead className="text-right">Ingresos reales</TableHead>
                  <TableHead className="text-right">Gastos reales</TableHead>
                  <TableHead className="text-right">Saldo real</TableHead>
                  <TableHead className="text-right">Ingresos presup.</TableHead>
                  <TableHead className="text-right">Gastos presup.</TableHead>
                  <TableHead className="text-right pr-5">Saldo proyectado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlySummaries.map((summary) => (
                  <TableRow key={summary.monthKey}>
                    <TableCell className="pl-5 font-medium text-sm">
                      <div className="flex items-center gap-2">
                        <span>{summary.label}</span>
                        {summary.hasPlannedData && !summary.hasRealData && (
                          <Badge variant="outline" className="text-[10px]">
                            Solo proyección
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatCLP(summary.openingBalance)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-emerald-600 dark:text-emerald-400">
                      {formatCLP(summary.realIncome)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-red-600 dark:text-red-400">
                      {formatCLP(summary.realExpenses)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-semibold text-blue-700 dark:text-blue-300">
                      {formatCLP(summary.realEndingBalance)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-emerald-600/80 dark:text-emerald-300">
                      {formatCLP(summary.plannedIncome)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-amber-700 dark:text-amber-300">
                      {formatCLP(summary.plannedExpenses)}
                    </TableCell>
                    <TableCell className="text-right pr-5 tabular-nums text-sm font-semibold">
                      {formatCLP(summary.projectedEndingBalance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
