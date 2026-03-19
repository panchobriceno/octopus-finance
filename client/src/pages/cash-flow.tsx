import { useMemo, useState } from "react";
import { useAccounts, useClientPayments, useTransactions } from "@/lib/hooks";
import { formatCLP } from "@/lib/utils";
import {
  buildDailyProjectionData,
  buildMonthlySummaries,
  combineFinancialTransactions,
  getCurrentMonthKey,
  getVatProjectionDateForMonth,
  summarizeClientPaymentsByMonth,
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
import type { ClientPayment, Transaction } from "@shared/schema";

type WeeklyCashViewMode = "current-month" | "next-4-weeks";

type WeeklyDetailItem = {
  id: string;
  label: string;
  date: string | null;
  amount: number;
  meta?: string | null;
};

type WeeklyColumn = {
  key: string;
  start: Date;
  end: Date;
  label: string;
};

type WeeklyBreakdown = {
  openingBalance: number;
  clientIncome: number;
  plannedExpenses: number;
  pendingCreditCard: number;
  endingBalance: number;
  details: {
    openingBalance: WeeklyDetailItem[];
    clientIncome: WeeklyDetailItem[];
    plannedExpenses: WeeklyDetailItem[];
    pendingCreditCard: WeeklyDetailItem[];
    endingBalance: WeeklyDetailItem[];
  };
};

function toStartOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function startOfWeekMonday(date: Date) {
  const normalized = toStartOfDay(date);
  const day = normalized.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  normalized.setDate(normalized.getDate() + diff);
  return normalized;
}

function endOfWeekSunday(date: Date) {
  const start = startOfWeekMonday(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addWeeks(date: Date, weeks: number) {
  return addDays(date, weeks * 7);
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function buildCurrentMonthWeeks(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, (month ?? 1) - 1, 1);
  const lastDay = new Date(year, month ?? 1, 0);
  const columns: WeeklyColumn[] = [];

  for (
    let cursor = startOfWeekMonday(firstDay);
    cursor <= lastDay;
    cursor = addWeeks(cursor, 1)
  ) {
    const start = new Date(cursor);
    const end = endOfWeekSunday(start);
    columns.push({
      key: `${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}`,
      start,
      end,
      label: `${formatShortDate(start)} - ${formatShortDate(end)}`,
    });
  }

  return columns;
}

function buildNextFourWeeks() {
  const today = new Date();
  const firstWeek = startOfWeekMonday(today);
  return Array.from({ length: 4 }, (_, index) => {
    const start = addWeeks(firstWeek, index);
    const end = endOfWeekSunday(start);
    return {
      key: `${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}`,
      start,
      end,
      label: `${formatShortDate(start)} - ${formatShortDate(end)}`,
    };
  });
}

function isDateWithinRange(dateValue: string | null | undefined, start: Date, end: Date) {
  const date = parseIsoDate(dateValue);
  if (!date) return false;
  const normalized = toStartOfDay(date);
  return normalized >= start && normalized <= end;
}

function matchesWorkspace(workspace: string | undefined | null, selectedWorkspace: WorkspaceFilter) {
  if (selectedWorkspace === "all") return true;
  return (workspace ?? "business") === selectedWorkspace;
}

export default function CashFlowPage() {
  const { data: transactions = [], isLoading } = useTransactions();
  const { data: clientPayments = [] } = useClientPayments();
  const { data: accounts = [] } = useAccounts();
  const currentMonthKey = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [workspace, setWorkspace] = useState<WorkspaceFilter>("all");
  const [weeklyViewMode, setWeeklyViewMode] = useState<WeeklyCashViewMode>("current-month");
  const [detailDialog, setDetailDialog] = useState<{
    title: string;
    description: string;
    items: WeeklyDetailItem[];
  } | null>(null);
  const { amount: openingBalance, update: updateOpeningBalance } = useOpeningBalance(selectedMonth);
  const financialTransactions = useMemo(
    () => combineFinancialTransactions(transactions, clientPayments),
    [transactions, clientPayments],
  );
  const clientPaymentsByMonth = useMemo(
    () => summarizeClientPaymentsByMonth(clientPayments),
    [clientPayments],
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
  const selectedMonthPaidVat = clientPaymentsByMonth[selectedMonth]?.paidVat ?? 0;
  const selectedMonthVatDueDate = getVatProjectionDateForMonth(selectedMonth);
  const totalAccountsBalance = useMemo(
    () => accounts.reduce((sum, account) => sum + (Number(account.currentBalance) || 0), 0),
    [accounts],
  );

  const weeklyColumns = useMemo(
    () => (weeklyViewMode === "current-month" ? buildCurrentMonthWeeks(selectedMonth) : buildNextFourWeeks()),
    [weeklyViewMode, selectedMonth],
  );

  const weeklyBreakdown = useMemo(() => {
    const relevantClientPayments = clientPayments.filter((payment) => {
      if (!matchesWorkspace(payment.workspace, workspace)) return false;
      return payment.status === "receivable" || payment.status === "projected";
    });

    const relevantTransactions = transactions.filter((transaction) => matchesWorkspace(transaction.workspace, workspace));
    let rollingOpeningBalance = totalAccountsBalance;

    return weeklyColumns.map((column, index): WeeklyBreakdown => {
      const clientIncomeItems = relevantClientPayments
        .filter((payment) => isDateWithinRange(payment.expectedDate ?? payment.dueDate, column.start, column.end))
        .map((payment) => ({
          id: payment.id,
          label: payment.clientName,
          date: payment.expectedDate ?? payment.dueDate ?? null,
          amount: payment.totalAmount,
          meta: payment.serviceItem ?? payment.status,
        }));

      const plannedExpenseItems = relevantTransactions
        .filter((transaction) => {
          const normalizedStatus = transaction.status ?? "pending";
          return (
            transaction.subtype === "planned" &&
            normalizedStatus === "pending" &&
            transaction.paymentMethod !== "credit_card" &&
            isDateWithinRange(transaction.date, column.start, column.end)
          );
        })
        .map((transaction) => ({
          id: transaction.id,
          label: transaction.name,
          date: transaction.date,
          amount: Math.abs(transaction.amount),
          meta: transaction.category,
        }));

      const pendingCreditCardItems = relevantTransactions
        .filter((transaction) => {
          const normalizedStatus = transaction.status ?? "pending";
          return (
            transaction.paymentMethod === "credit_card" &&
            normalizedStatus === "pending" &&
            isDateWithinRange(transaction.date, column.start, column.end)
          );
        })
        .map((transaction) => ({
          id: transaction.id,
          label: transaction.name,
          date: transaction.date,
          amount: Math.abs(transaction.amount),
          meta: transaction.creditCardName ?? transaction.category,
        }));

      const clientIncome = clientIncomeItems.reduce((sum, item) => sum + item.amount, 0);
      const plannedExpenses = plannedExpenseItems.reduce((sum, item) => sum + item.amount, 0);
      const pendingCreditCard = pendingCreditCardItems.reduce((sum, item) => sum + item.amount, 0);
      const openingBalanceValue = index === 0 ? totalAccountsBalance : rollingOpeningBalance;
      const endingBalance = openingBalanceValue + clientIncome - plannedExpenses - pendingCreditCard;

      const details = {
        openingBalance: [
          {
            id: `opening-${column.key}`,
            label: "Saldo sumado de cuentas",
            date: column.start.toISOString().slice(0, 10),
            amount: openingBalanceValue,
            meta: `${accounts.length} cuenta(s) consideradas`,
          },
        ],
        clientIncome: clientIncomeItems,
        plannedExpenses: plannedExpenseItems,
        pendingCreditCard: pendingCreditCardItems,
        endingBalance: [
          {
            id: `ending-${column.key}-opening`,
            label: "Saldo inicial",
            date: column.start.toISOString().slice(0, 10),
            amount: openingBalanceValue,
          },
          ...clientIncomeItems.map((item) => ({ ...item, meta: `Ingreso cliente${item.meta ? ` · ${item.meta}` : ""}` })),
          ...plannedExpenseItems.map((item) => ({ ...item, amount: -item.amount, meta: `Gasto presupuestado${item.meta ? ` · ${item.meta}` : ""}` })),
          ...pendingCreditCardItems.map((item) => ({ ...item, amount: -item.amount, meta: `Pago tarjeta${item.meta ? ` · ${item.meta}` : ""}` })),
        ],
      };

      rollingOpeningBalance = endingBalance;

      return {
        openingBalance: openingBalanceValue,
        clientIncome,
        plannedExpenses,
        pendingCreditCard,
        endingBalance,
        details,
      };
    });
  }, [accounts.length, clientPayments, selectedMonth, totalAccountsBalance, transactions, weeklyColumns, workspace]);

  const openWeeklyDetail = (
    rowKey: keyof WeeklyBreakdown["details"],
    weekIndex: number,
    weekLabel: string,
    rowLabel: string,
  ) => {
    const breakdown = weeklyBreakdown[weekIndex];
    if (!breakdown) return;

    setDetailDialog({
      title: `${rowLabel} · ${weekLabel}`,
      description: "Detalle de movimientos considerados en esa celda semanal.",
      items: breakdown.details[rowKey],
    });
  };

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
                <SelectItem value="dentist">Consulta Dentista</SelectItem>
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
          <CardContent className="pt-5 grid gap-3 sm:grid-cols-4">
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
            <div>
              <p className="text-sm text-muted-foreground">IVA proyectado próximo 20</p>
              <p className="text-lg font-semibold tabular-nums mt-1 text-amber-700 dark:text-amber-300">{formatCLP(selectedMonthPaidVat)}</p>
              <p className="text-xs text-muted-foreground mt-1">{selectedMonthVatDueDate}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base font-semibold">Flujo de Caja Semanal</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={weeklyViewMode === "current-month" ? "default" : "outline"}
                size="sm"
                onClick={() => setWeeklyViewMode("current-month")}
                data-testid="button-weekly-current-month"
              >
                Mes actual
              </Button>
              <Button
                variant={weeklyViewMode === "next-4-weeks" ? "default" : "outline"}
                size="sm"
                onClick={() => setWeeklyViewMode("next-4-weeks")}
                data-testid="button-weekly-next-4-weeks"
              >
                Próximas 4 semanas
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table className="zebra-stripe" data-testid="table-cashflow-weekly">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5 min-w-[220px]">Concepto</TableHead>
                  {weeklyColumns.map((column) => (
                    <TableHead key={column.key} className="text-right min-w-[180px]">
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="pl-5 font-medium text-sm">Saldo inicial</TableCell>
                  {weeklyBreakdown.map((week, index) => (
                    <TableCell key={`opening-${weeklyColumns[index]?.key}`} className="text-right">
                      <Button
                        variant="ghost"
                        className="h-auto p-0 text-right font-medium tabular-nums"
                        onClick={() => openWeeklyDetail("openingBalance", index, weeklyColumns[index].label, "Saldo inicial")}
                      >
                        {formatCLP(week.openingBalance)}
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow className="bg-emerald-50/40 dark:bg-emerald-950/10">
                  <TableCell className="pl-5 font-medium text-sm text-emerald-700 dark:text-emerald-300">
                    Ingresos clientes
                  </TableCell>
                  {weeklyBreakdown.map((week, index) => (
                    <TableCell key={`income-${weeklyColumns[index]?.key}`} className="text-right">
                      <Button
                        variant="ghost"
                        className="h-auto p-0 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-300"
                        onClick={() => openWeeklyDetail("clientIncome", index, weeklyColumns[index].label, "Ingresos clientes")}
                      >
                        {formatCLP(week.clientIncome)}
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow className="bg-red-50/40 dark:bg-red-950/10">
                  <TableCell className="pl-5 font-medium text-sm text-red-700 dark:text-red-300">
                    Gastos presupuestados
                  </TableCell>
                  {weeklyBreakdown.map((week, index) => (
                    <TableCell key={`planned-${weeklyColumns[index]?.key}`} className="text-right">
                      <Button
                        variant="ghost"
                        className="h-auto p-0 text-right font-medium tabular-nums text-red-700 dark:text-red-300"
                        onClick={() => openWeeklyDetail("plannedExpenses", index, weeklyColumns[index].label, "Gastos presupuestados")}
                      >
                        {formatCLP(week.plannedExpenses)}
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow className="bg-red-50/40 dark:bg-red-950/10">
                  <TableCell className="pl-5 font-medium text-sm text-red-700 dark:text-red-300">
                    Pagos tarjeta de crédito
                  </TableCell>
                  {weeklyBreakdown.map((week, index) => (
                    <TableCell key={`cards-${weeklyColumns[index]?.key}`} className="text-right">
                      <Button
                        variant="ghost"
                        className="h-auto p-0 text-right font-medium tabular-nums text-red-700 dark:text-red-300"
                        onClick={() => openWeeklyDetail("pendingCreditCard", index, weeklyColumns[index].label, "Pagos tarjeta de crédito")}
                      >
                        {formatCLP(week.pendingCreditCard)}
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="pl-5 font-semibold text-sm">Saldo final</TableCell>
                  {weeklyBreakdown.map((week, index) => {
                    const isNegative = week.endingBalance < 0;
                    const isLowWarning = !isNegative && week.openingBalance > 0 && week.endingBalance < week.openingBalance * 0.2;
                    const cellClass = isNegative
                      ? "text-red-700 dark:text-red-300"
                      : isLowWarning
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-blue-700 dark:text-blue-300";

                    return (
                      <TableCell
                        key={`ending-${weeklyColumns[index]?.key}`}
                        className={`text-right ${isNegative ? "bg-red-50/60 dark:bg-red-950/15" : isLowWarning ? "bg-amber-50/60 dark:bg-amber-950/15" : ""}`}
                      >
                        <Button
                          variant="ghost"
                          className={`h-auto p-0 text-right font-semibold tabular-nums ${cellClass}`}
                          onClick={() => openWeeklyDetail("endingBalance", index, weeklyColumns[index].label, "Saldo final")}
                        >
                          {formatCLP(week.endingBalance)}
                        </Button>
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

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

      <Dialog open={!!detailDialog} onOpenChange={(open) => { if (!open) setDetailDialog(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detailDialog?.title ?? "Detalle semanal"}</DialogTitle>
            <DialogDescription>
              {detailDialog?.description ?? "Detalle de movimientos"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[420px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Detalle</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detailDialog?.items ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm">{item.date ?? "—"}</TableCell>
                    <TableCell className="text-sm font-medium">{item.label}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.meta ?? "—"}</TableCell>
                    <TableCell className={`text-right text-sm tabular-nums ${item.amount < 0 ? "text-red-700 dark:text-red-300" : ""}`}>
                      {formatCLP(item.amount)}
                    </TableCell>
                  </TableRow>
                ))}
                {(detailDialog?.items?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                      No hay movimientos en esta celda.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
