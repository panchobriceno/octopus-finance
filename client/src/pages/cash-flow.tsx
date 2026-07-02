import { useMemo, useState } from "react";
import { useAccounts, useClientPayments, useTransactions, useCommitmentInstances, useCreditCardStatements } from "@/lib/hooks";
import { buildCardDebt } from "@/domain/debt";
import { buildCashFlowFinancialTransactions } from "@/domain/cash-obligations";
import { cn, formatCLP, getMonthName } from "@/lib/utils";
import {
  buildDailyProjectionData,
  buildMonthlySummaries,
  getCurrentMonthKey,
  getTodayLocalDateKey,
  getVatProjectionDateForMonth,
  summarizeClientPaymentsByMonth,
  summarizeWorkspaceTransactions,
  type WorkspaceFilter,
} from "@/lib/finance";
import { useMonthlyBalances, useOpeningBalance } from "@/lib/monthly-balances";
import { getAvailableCashBalance } from "@/domain/accounts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CashflowWaterfall } from "@/components/finance/cashflow-waterfall";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowUp, ArrowUpDown, Calendar } from "lucide-react";
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

// Fecha local YYYY-MM-DD sin depender del huso: siempre el día calendario local.
// (toISOString() sobre medianoche local puede devolver otro día según la zona; esto no.)
function toLocalIsoDate(date: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
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
      key: `${toLocalIsoDate(start)}_${toLocalIsoDate(end)}`,
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
      key: `${toLocalIsoDate(start)}_${toLocalIsoDate(end)}`,
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
  const { data: commitments = [] } = useCommitmentInstances();
  const { data: creditCardStatements = [] } = useCreditCardStatements();
  const currentMonthKey = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [workspace, setWorkspace] = useState<WorkspaceFilter>("all");
  const [weeklyViewMode, setWeeklyViewMode] = useState<WeeklyCashViewMode>("current-month");
  const [detailDialog, setDetailDialog] = useState<{
    title: string;
    description: string;
    items: WeeklyDetailItem[];
  } | null>(null);
  const { balances: openingBalancesMap } = useMonthlyBalances();
  const { amount: openingBalance, update: updateOpeningBalance } = useOpeningBalance(selectedMonth);
  // Motor UNIFICADO con el asesor: mismas obligaciones (commitments + pago real de tarjeta de cartola),
  // sin cuotas proyectadas (evita doble-conteo). asOf usa fecha local para no adelantarse de noche.
  const asOf = getTodayLocalDateKey();
  const cardDebts = useMemo(
    () => buildCardDebt(creditCardStatements, transactions, accounts, { asOf }),
    [creditCardStatements, transactions, accounts, asOf],
  );
  const financialTransactions = useMemo(
    () => buildCashFlowFinancialTransactions({
      transactions,
      clientPayments,
      commitments,
      cardDebts,
      cardAccounts: accounts.filter((a) => a.type === "credit_card"),
      asOf,
    }),
    [transactions, clientPayments, commitments, cardDebts, accounts, asOf],
  );
  const clientPaymentsByMonth = useMemo(
    () => summarizeClientPaymentsByMonth(clientPayments),
    [clientPayments],
  );

  const monthlySummaries = useMemo(() => {
    const openingBalances = {
      ...openingBalancesMap,
      [selectedMonth]: openingBalance,
    };
    return buildMonthlySummaries(financialTransactions, openingBalances, workspace);
  }, [financialTransactions, openingBalancesMap, selectedMonth, openingBalance, workspace]);

  const workspaceMetrics = useMemo(
    () => summarizeWorkspaceTransactions(financialTransactions, workspace, accounts),
    [accounts, financialTransactions, workspace],
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
    () => getAvailableCashBalance(accounts, workspace),
    [accounts, workspace],
  );

  const weeklyColumns = useMemo(
    () => (weeklyViewMode === "current-month" ? buildCurrentMonthWeeks(selectedMonth) : buildNextFourWeeks()),
    [weeklyViewMode, selectedMonth],
  );

  const weeklyBreakdown = useMemo(() => {
    const relevantClientPayments = clientPayments.filter((payment) => {
      if (!matchesWorkspace(payment.workspace, workspace)) return false;
      return payment.status === "receivable" || payment.status === "projected" || payment.status === "invoiced";
    });

    const relevantTransactions = financialTransactions.filter((transaction) => matchesWorkspace(transaction.workspace, workspace));
    let rollingOpeningBalance = totalAccountsBalance;

    return weeklyColumns.map((column, index): WeeklyBreakdown => {
      const clientIncomeItems = relevantClientPayments
        .filter((payment) => isDateWithinRange(payment.expectedDate ?? payment.dueDate, column.start, column.end))
        .map((payment) => ({
          id: payment.id,
          label: payment.clientName,
          date: payment.expectedDate ?? payment.dueDate ?? null,
          amount: payment.netAmount, // NETO: la caja se mueve en lo tuyo usable; el IVA va aparte (tarjeta "IVA a separar")
          meta: payment.serviceItem ?? payment.status,
        }));

      const plannedExpenseItems = relevantTransactions
        .filter((transaction) => {
          const normalizedStatus = transaction.status ?? "pending";
          return (
            transaction.subtype === "planned" &&
            normalizedStatus === "pending" &&
            transaction.movementType === "expense" && // SOLO gastos (no ingresos ni pago de tarjeta sintéticos)
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
          const normalizedSubtype = transaction.subtype ?? "actual";
          return (
            transaction.movementType === "credit_card_payment" &&
            normalizedStatus === "pending" &&
            normalizedSubtype === "planned" &&
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
            date: toLocalIsoDate(column.start),
            amount: openingBalanceValue,
            meta: "Cuentas corrientes y de ahorro; tarjetas excluidas",
          },
        ],
        clientIncome: clientIncomeItems,
        plannedExpenses: plannedExpenseItems,
        pendingCreditCard: pendingCreditCardItems,
        endingBalance: [
          {
            id: `ending-${column.key}-opening`,
            label: "Saldo inicial",
            date: toLocalIsoDate(column.start),
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
  }, [clientPayments, selectedMonth, totalAccountsBalance, financialTransactions, weeklyColumns, workspace]);

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

  const ambitoLabel =
    workspace === "all" ? "Consolidado" : workspace === "business" ? "Empresa" : workspace === "family" ? "Familia" : "Consulta";
  const monthLabel = (key: string) => {
    const [y, m] = key.split("-");
    return `${getMonthName(Number(m) - 1)} ${y}`;
  };
  // Guard presentacional: nunca mostrar "$NaN"; cae a "—".
  const fmt = (v: number) => (Number.isFinite(v) ? formatCLP(v) : "—");
  // Cero/NaN repetido va en gris bajo; solo los valores con dato llevan color pleno.
  const dimIfZero = (v: number, color: string) => (!Number.isFinite(v) || v === 0 ? "text-[#3a3a44]" : color);
  const now = new Date();
  const asOfLabel = `al ${now.getDate()} ${getMonthName(now.getMonth()).slice(0, 3).toLowerCase()}`;
  const todayPoint = selectedMonth === currentMonthKey ? chartData[now.getDate() - 1] : undefined;

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
    <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
      {/* 1 — Header + selectores */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl border border-card-border bg-secondary text-[#cdfa46]">
            <ArrowUpDown className="size-4" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight">Flujo de Caja</h2>
            <p className="mt-0.5 text-xs text-[#9a9aa6]">
              {monthLabel(selectedMonth)} · {ambitoLabel} · saldo inicial{" "}
              <span className="font-mono text-[#cfcfd8]">{fmt(selectedSummary.openingBalance)}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={workspace} onValueChange={(value) => setWorkspace(value as WorkspaceFilter)}>
            <SelectTrigger className="w-[150px] border-card-border bg-secondary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Consolidado</SelectItem>
              <SelectItem value="business">Empresa</SelectItem>
              <SelectItem value="family">Familia</SelectItem>
              <SelectItem value="dentist">Consulta Dentista</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[160px] gap-2 border-card-border bg-secondary" data-testid="select-cashflow-month">
              <Calendar className="size-3.5 text-[#9a9aa6]" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableMonths.map((monthKey) => (
                <SelectItem key={monthKey} value={monthKey}>
                  {monthLabel(monthKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex h-10 items-center gap-2 rounded-lg border border-card-border bg-secondary px-3">
            <span className="whitespace-nowrap text-xs text-[#9a9aa6]">Saldo inicial</span>
            <Input
              type="number"
              value={String(openingBalance)}
              onChange={(e) => updateOpeningBalance(Number(e.target.value || 0))}
              data-testid="input-cashflow-opening-balance"
              className="h-8 w-28 border-0 bg-transparent px-0 font-mono text-sm tabular-nums focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
        </div>
      </div>

      {/* 2 — Ejecutado vs Proyectado */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-[20px] border-card-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-[#9a9aa6]">
                <span className="inline-block h-px w-4 bg-[#f4f4f7]" /> Saldo ejecutado
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold text-[#9a9aa6]">{asOfLabel}</span>
            </div>
            <p className="mt-3 font-mono text-4xl font-extrabold tabular-nums text-[#f4f4f7]">
              {fmt(selectedSummary.realEndingBalance)}
            </p>
            <p className="mt-2 font-mono text-xs text-[#6c6c78]">
              {fmt(selectedSummary.openingBalance)} + {fmt(selectedSummary.realIncome)} − {fmt(selectedSummary.realExpenses)}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-card-border bg-[#0d0d12] p-3">
                <p className="flex items-center gap-1.5 text-xs text-[#9a9aa6]">
                  <ArrowUp className="size-3.5 text-[#cdfa46]" /> Ingresos reales
                </p>
                <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#cdfa46]">
                  +{fmt(selectedSummary.realIncome)}
                </p>
              </div>
              <div className="rounded-xl border border-card-border bg-[#0d0d12] p-3">
                <p className="flex items-center gap-1.5 text-xs text-[#9a9aa6]">
                  <ArrowDown className="size-3.5 text-[#e3e3ea]" /> Gastos reales
                </p>
                <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#e3e3ea]">
                  −{fmt(selectedSummary.realExpenses)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[20px] border border-dashed border-[#cdfa46]/40 bg-card">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold text-[#9a9aa6]">
                <span className="inline-block h-px w-4 border-t border-dashed border-[#cdfa46]" /> Saldo proyectado fin de mes
              </span>
              <span className="rounded-full bg-[rgba(205,250,70,0.12)] px-2.5 py-1 text-[10px] font-bold text-[#cdfa46]">proyección</span>
            </div>
            <p className="mt-3 font-mono text-4xl font-extrabold tabular-nums text-[#cdfa46]">
              {fmt(selectedSummary.projectedEndingBalance)}
            </p>
            <p className="mt-2 font-mono text-xs text-[#6c6c78]">
              {fmt(selectedSummary.realEndingBalance)} + {fmt(selectedSummary.plannedIncome)} esperados − {fmt(selectedSummary.plannedExpenses)}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-card-border bg-[#0d0d12] p-3">
                <p className="text-xs text-[#9a9aa6]">Ingresos esperados</p>
                <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#cdfa46]/70">
                  +{fmt(selectedSummary.plannedIncome)}
                </p>
              </div>
              <div className="rounded-xl border border-card-border bg-[#0d0d12] p-3">
                <p className="text-xs text-[#9a9aa6]">Gastos esperados</p>
                <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#8a8a94]">
                  −{fmt(selectedSummary.plannedExpenses)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3 + 4 — Cascada del mes + strip de métricas */}
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <CashflowWaterfall
          className={cn("rounded-[20px] border-card-border", workspace === "family" && "xl:col-span-2")}
          openingBalance={selectedSummary.openingBalance}
          realIncome={selectedSummary.realIncome}
          realExpenses={selectedSummary.realExpenses}
          realEndingBalance={selectedSummary.realEndingBalance}
          plannedIncome={selectedSummary.plannedIncome}
          plannedExpenses={selectedSummary.plannedExpenses}
          projectedEndingBalance={selectedSummary.projectedEndingBalance}
        />

        {workspace !== "family" && (
          <div className="grid grid-cols-2 content-start gap-4">
            <div className="rounded-[18px] border border-card-border bg-card p-4">
              <p className="text-xs text-[#9a9aa6]">Deuda tarjeta</p>
              <p className="mt-2 font-mono text-[22px] font-bold tabular-nums text-[#f4f4f7]">{fmt(workspaceMetrics.creditCardDebt)}</p>
            </div>
            <div className="rounded-[18px] border border-card-border bg-card p-4">
              <p className="text-xs text-[#9a9aa6]">IVA a separar · vence {selectedMonthVatDueDate}</p>
              <p className="mt-2 font-mono text-[22px] font-bold tabular-nums text-[#8a8a94]">{fmt(selectedMonthPaidVat)}</p>
              <p className="mt-1 text-[10px] text-[#6c6c78]">Aparte de tu caja: es plata de impuestos, no se descuenta del flujo.</p>
            </div>
            <div className="rounded-[18px] border border-card-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs text-[#9a9aa6]">
                <ArrowUp className="size-3.5 text-[#cdfa46]" /> Transferencias recibidas
              </p>
              <p className="mt-2 font-mono text-[22px] font-bold tabular-nums text-[#cdfa46]">{fmt(workspaceMetrics.transfersIn)}</p>
            </div>
            <div className="rounded-[18px] border border-card-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs text-[#9a9aa6]">
                <ArrowDown className="size-3.5 text-[#e3e3ea]" /> Transferencias enviadas
              </p>
              <p className="mt-2 font-mono text-[22px] font-bold tabular-nums text-[#e3e3ea]">{fmt(workspaceMetrics.transfersOut)}</p>
            </div>
          </div>
        )}
      </div>

      {/* 5 — Saldo diario · ejecutado vs proyectado */}
      <Card className="rounded-[20px] border-card-border">
        <CardHeader className="flex flex-col gap-1 pb-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-[15px] font-bold">Saldo diario · ejecutado vs proyectado</CardTitle>
            <p className="mt-0.5 text-xs text-[#9a9aa6]">{monthLabel(selectedMonth)} · día a día</p>
          </div>
          <div className="flex items-center gap-4 text-xs font-semibold">
            <span className="flex items-center gap-1.5 text-[#f4f4f7]">
              <span className="inline-block h-px w-5 bg-[#f4f4f7]" />Ejecutado
            </span>
            <span className="flex items-center gap-1.5 text-[#cdfa46]">
              <span className="inline-block h-px w-5 border-t border-dashed border-[#cdfa46]" />Proyectado
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-80" data-testid="chart-cashflow">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="0" stroke="#1c1c24" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#6c6c78", fontFamily: "JetBrains Mono" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#6c6c78", fontFamily: "JetBrains Mono" }}
                  tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                />
                <Tooltip
                  formatter={(value: number) => formatCLP(value)}
                  contentStyle={{ backgroundColor: "#15151c", border: "1px solid #22222b", borderRadius: "10px", fontSize: "13px" }}
                  labelStyle={{ color: "#9a9aa6" }}
                />
                <ReferenceLine y={0} stroke="#1c1c24" />
                {todayPoint ? <ReferenceLine x={todayPoint.label} stroke="#2a2a34" strokeWidth={1} /> : null}
                <Line type="monotone" dataKey="realBalance" name="Ejecutado" stroke="#f4f4f7" strokeWidth={2.5} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="projectedBalance" name="Proyectado" stroke="#cdfa46" strokeWidth={2.5} strokeDasharray="6 6" dot={false} />
                {todayPoint ? (
                  <ReferenceDot x={todayPoint.label} y={todayPoint.projectedBalance ?? todayPoint.realBalance} r={4} fill="#cdfa46" stroke="#0a0a0f" strokeWidth={2} />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* 6a — Flujo de Caja Semanal */}
      <Card className="rounded-[20px] border-card-border">
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-[15px] font-bold">Flujo de Caja Semanal</CardTitle>
          <div className="inline-flex flex-none rounded-full border border-card-border bg-[#121219] p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setWeeklyViewMode("current-month")}
              data-testid="button-weekly-current-month"
              className={cn(
                "rounded-full px-3 py-1.5 transition",
                weeklyViewMode === "current-month" ? "bg-[#cdfa46] text-[#0a0a0f]" : "text-[#9a9aa6] hover:text-[#f4f4f7]",
              )}
            >
              Mes actual
            </button>
            <button
              type="button"
              onClick={() => setWeeklyViewMode("next-4-weeks")}
              data-testid="button-weekly-next-4-weeks"
              className={cn(
                "rounded-full px-3 py-1.5 transition",
                weeklyViewMode === "next-4-weeks" ? "bg-[#cdfa46] text-[#0a0a0f]" : "text-[#9a9aa6] hover:text-[#f4f4f7]",
              )}
            >
              Próximas 4 semanas
            </button>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table className="zebra-stripe [&_td]:py-2.5" data-testid="table-cashflow-weekly">
              <TableHeader>
                <TableRow className="border-[#1e1e26] hover:bg-transparent">
                  <TableHead className="sticky left-0 z-[1] min-w-[200px] bg-card pl-5 text-[10.5px] uppercase tracking-wide text-[#6c6c78]">Concepto</TableHead>
                  {weeklyColumns.map((column) => (
                    <TableHead key={column.key} className="min-w-[170px] text-right text-[10.5px] uppercase tracking-wide text-[#6c6c78]">
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-[#1e1e26]">
                  <TableCell className="sticky left-0 z-[1] bg-card pl-5 text-sm font-medium">Saldo inicial</TableCell>
                  {weeklyBreakdown.map((week, index) => (
                    <TableCell key={`opening-${weeklyColumns[index]?.key}`} className="text-right">
                      <Button
                        variant="ghost"
                        className="h-auto p-0 text-right font-mono font-medium tabular-nums text-[#f4f4f7]"
                        onClick={() => openWeeklyDetail("openingBalance", index, weeklyColumns[index].label, "Saldo inicial")}
                      >
                        {fmt(week.openingBalance)}
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow className="border-[#1e1e26]">
                  <TableCell className="sticky left-0 z-[1] bg-card pl-5 text-sm font-medium text-[#cdfa46]">
                    Ingresos clientes
                  </TableCell>
                  {weeklyBreakdown.map((week, index) => (
                    <TableCell key={`income-${weeklyColumns[index]?.key}`} className="text-right">
                      <Button
                        variant="ghost"
                        className="h-auto p-0 text-right font-mono font-medium tabular-nums text-[#cdfa46]"
                        onClick={() => openWeeklyDetail("clientIncome", index, weeklyColumns[index].label, "Ingresos clientes")}
                      >
                        {fmt(week.clientIncome)}
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow className="border-[#1e1e26]">
                  <TableCell className="sticky left-0 z-[1] bg-card pl-5 text-sm font-medium text-[#8a8a94]">
                    Gastos presupuestados
                  </TableCell>
                  {weeklyBreakdown.map((week, index) => (
                    <TableCell key={`planned-${weeklyColumns[index]?.key}`} className="text-right">
                      <Button
                        variant="ghost"
                        className="h-auto p-0 text-right font-mono font-medium tabular-nums text-[#8a8a94]"
                        onClick={() => openWeeklyDetail("plannedExpenses", index, weeklyColumns[index].label, "Gastos presupuestados")}
                      >
                        {fmt(week.plannedExpenses)}
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow className="border-[#1e1e26]">
                  <TableCell className="sticky left-0 z-[1] bg-card pl-5 text-sm font-medium text-[#e3e3ea]">
                    Pagos tarjeta de crédito
                  </TableCell>
                  {weeklyBreakdown.map((week, index) => (
                    <TableCell key={`cards-${weeklyColumns[index]?.key}`} className="text-right">
                      <Button
                        variant="ghost"
                        className="h-auto p-0 text-right font-mono font-medium tabular-nums text-[#e3e3ea]"
                        onClick={() => openWeeklyDetail("pendingCreditCard", index, weeklyColumns[index].label, "Pagos tarjeta de crédito")}
                      >
                        {fmt(week.pendingCreditCard)}
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow className="border-t border-card-border bg-secondary hover:bg-secondary">
                  <TableCell className="sticky left-0 z-[1] bg-secondary pl-5 text-sm font-bold">Saldo final</TableCell>
                  {weeklyBreakdown.map((week, index) => (
                    <TableCell key={`ending-${weeklyColumns[index]?.key}`} className="text-right">
                      <Button
                        variant="ghost"
                        className="h-auto p-0 text-right font-mono font-bold tabular-nums text-[#9aa0aa]"
                        onClick={() => openWeeklyDetail("endingBalance", index, weeklyColumns[index].label, "Saldo final")}
                      >
                        {fmt(week.endingBalance)}
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 6b — Desglose Mensual */}
      <Card className="rounded-[20px] border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-bold">Desglose mensual</CardTitle>
          <p className="text-xs text-[#9a9aa6]">Real vs presupuestado, mes a mes · {ambitoLabel}</p>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table className="zebra-stripe [&_td]:py-2.5" data-testid="table-cashflow">
              <TableHeader>
                <TableRow className="border-[#1e1e26] hover:bg-transparent">
                  <TableHead className="sticky left-0 z-[1] bg-card pl-5 text-[10.5px] uppercase tracking-wide text-[#6c6c78]">Mes</TableHead>
                  <TableHead className="text-right text-[10.5px] uppercase tracking-wide text-[#6c6c78]">Saldo inicial</TableHead>
                  <TableHead className="text-right text-[10.5px] uppercase tracking-wide text-[#6c6c78]">Ingresos reales</TableHead>
                  <TableHead className="text-right text-[10.5px] uppercase tracking-wide text-[#6c6c78]">Gastos reales</TableHead>
                  <TableHead className="text-right text-[10.5px] uppercase tracking-wide text-[#6c6c78]">Saldo real</TableHead>
                  <TableHead className="text-right text-[10.5px] uppercase tracking-wide text-[#6c6c78]">Ing. presup.</TableHead>
                  <TableHead className="text-right text-[10.5px] uppercase tracking-wide text-[#6c6c78]">Gas. presup.</TableHead>
                  <TableHead className="pr-5 text-right text-[10.5px] uppercase tracking-wide text-[#6c6c78]">Saldo proyect.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlySummaries.map((summary) => {
                  const isCurrent = summary.monthKey === currentMonthKey;
                  const inactive = !summary.hasRealData && !summary.hasPlannedData;
                  const onlyProjection = summary.hasPlannedData && !summary.hasRealData;
                  return (
                    <TableRow
                      key={summary.monthKey}
                      className={cn("border-[#1e1e26]", isCurrent && "bg-[rgba(205,250,70,0.05)]", inactive && "opacity-45")}
                    >
                      <TableCell className={cn("sticky left-0 z-[1] pl-5 text-sm font-medium", isCurrent ? "bg-[#191b12]" : "bg-card")}>
                        <div className="flex items-center gap-2">
                          <span>{summary.label}</span>
                          {onlyProjection && (
                            <span className="rounded-full bg-[rgba(205,250,70,0.12)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#cdfa46]">
                              Solo proyección
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm tabular-nums", dimIfZero(summary.openingBalance, "text-[#f4f4f7]"))}>
                        {fmt(summary.openingBalance)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm tabular-nums", dimIfZero(summary.realIncome, "text-[#cdfa46]"))}>
                        {fmt(summary.realIncome)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm tabular-nums", dimIfZero(summary.realExpenses, "text-[#e3e3ea]"))}>
                        {fmt(summary.realExpenses)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm font-semibold tabular-nums", dimIfZero(summary.realEndingBalance, "text-[#f4f4f7]"))}>
                        {fmt(summary.realEndingBalance)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm tabular-nums", dimIfZero(summary.plannedIncome, "text-[#8a8a94]"))}>
                        {fmt(summary.plannedIncome)}
                      </TableCell>
                      <TableCell className={cn("text-right font-mono text-sm tabular-nums", dimIfZero(summary.plannedExpenses, "text-[#8a8a94]"))}>
                        {fmt(summary.plannedExpenses)}
                      </TableCell>
                      <TableCell className={cn("pr-5 text-right font-mono text-sm font-semibold tabular-nums", dimIfZero(summary.projectedEndingBalance, "text-[#8a8a94]"))}>
                        {fmt(summary.projectedEndingBalance)}
                      </TableCell>
                    </TableRow>
                  );
                })}
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
                    <TableCell className={`text-right text-sm tabular-nums ${item.amount < 0 ? "text-[#e3e3ea]" : ""}`}>
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
