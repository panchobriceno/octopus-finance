import { useMemo, useState, type ReactNode } from "react";
import {
  useAccounts,
  useClientPayments,
  useCommitmentInstances,
  useCreditCardStatements,
  useTransactions,
} from "@/lib/hooks";
import { cn, formatCLP, getMonthName } from "@/lib/utils";
import { buildCardDebt } from "@/domain/debt";
import { buildCashFlowFinancialTransactions } from "@/domain/cash-obligations";
import {
  getTodayLocalDateKey,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, LineChart, TrendingDown, TrendingUp } from "lucide-react";

interface CellTotals {
  real: number;
  planned: number;
}

type RowType = "income" | "expense" | "neutral";
type ViewMode = "real" | "mixto" | "planned";

// lima = favorable, gris = desfavorable. En gastos, "favorable" es gastar
// MENOS que lo presupuestado (varianza <= 0).
function isFavorable(variance: number, type: RowType) {
  return type === "expense" ? variance <= 0 : variance >= 0;
}

function PnlCell({
  value,
  type = "neutral",
  viewMode = "mixto",
}: {
  value: CellTotals;
  type?: RowType;
  viewMode?: ViewMode;
}) {
  const variance = value.real - value.planned;
  const favorable = isFavorable(variance, type);
  const hasData = value.real !== 0 || value.planned !== 0;

  if (!hasData) {
    return <div className="text-right font-mono text-xs text-[#3a3a44]">—</div>;
  }

  if (viewMode === "real") {
    return (
      <div className="text-right font-mono text-sm tabular-nums text-[#f4f4f7]">{formatCLP(value.real)}</div>
    );
  }

  if (viewMode === "planned") {
    return (
      <div className="text-right font-mono text-sm tabular-nums text-[#9a9aa6]">{formatCLP(value.planned)}</div>
    );
  }

  return (
    <div className="space-y-0.5 text-right leading-tight">
      <div className="font-mono text-sm tabular-nums text-[#f4f4f7]">{formatCLP(value.real)}</div>
      <div className="font-mono text-xs tabular-nums text-[#6c6c78]">Presup. {formatCLP(value.planned)}</div>
      <div
        className={cn(
          "font-mono text-xs font-medium tabular-nums",
          favorable ? "text-[#cdfa46]" : "text-[#8a8a94]",
        )}
      >
        Var. {variance >= 0 ? "+" : ""}{formatCLP(variance)}
      </div>
    </div>
  );
}

function PnlKpi({
  icon,
  label,
  value,
  planned,
  type,
  badge,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  planned: number;
  type: RowType;
  badge?: ReactNode;
}) {
  const variance = value - planned;
  const favorable = isFavorable(variance, type);
  const valueClass = type === "income" ? "text-[#cdfa46]" : "text-[#e3e3ea]";

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col p-[18px]">
        <div className="flex items-center gap-2">
          <span className="text-[#cfcfd8]">{icon}</span>
          <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{label}</p>
          {badge ? <span className="ml-auto">{badge}</span> : null}
        </div>
        <p className={cn("mt-3 font-mono text-[22px] font-bold leading-none tabular-nums", valueClass)}>
          {formatCLP(value)}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-xs">
          <span className="font-mono text-[hsl(var(--muted-foreground))]">Presup. {formatCLP(planned)}</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 font-mono font-semibold",
              favorable
                ? "bg-[rgba(205,250,70,0.12)] text-[#cdfa46]"
                : "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]",
            )}
          >
            {variance >= 0 ? "+" : ""}{formatCLP(variance)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

const STICKY = "sticky left-0 z-[1] bg-card";

export default function PnLPage() {
  const { data: transactions = [], isLoading: txLoading } = useTransactions();
  const { data: clientPayments = [] } = useClientPayments();
  const { data: accounts = [] } = useAccounts();
  const { data: commitments = [] } = useCommitmentInstances();
  const { data: creditCardStatements = [] } = useCreditCardStatements();
  const [workspace, setWorkspace] = useState<WorkspaceFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("mixto");
  const asOf = getTodayLocalDateKey();
  const cardDebts = useMemo(
    () => buildCardDebt(creditCardStatements, transactions, accounts, { asOf }),
    [accounts, asOf, creditCardStatements, transactions],
  );
  const financialTransactions = useMemo(
    () =>
      buildCashFlowFinancialTransactions({
        transactions,
        clientPayments,
        commitments,
        cardDebts,
        cardAccounts: accounts.filter((account) => account.type === "credit_card"),
        asOf,
        includeManualPlanned: true,
      }),
    [accounts, asOf, cardDebts, clientPayments, commitments, transactions],
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

  const netDeficit = model.grandNet.real < 0;

  return (
    <div className="h-full space-y-6 overflow-y-auto p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <FileText className="size-5 text-[#cdfa46]" />
          <h2 className="text-xl font-extrabold tracking-tight">Estado de Resultados</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#9a9aa6]">Ámbito:</span>
          <Select value={workspace} onValueChange={(value) => setWorkspace(value as WorkspaceFilter)}>
            <SelectTrigger className="w-44 border-card-border bg-secondary">
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
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PnlKpi
          icon={<TrendingUp className="size-4" />}
          label="Ingresos"
          value={model.grandIncome.real}
          planned={model.grandIncome.planned}
          type="income"
        />
        <PnlKpi
          icon={<TrendingDown className="size-4" />}
          label="Gastos"
          value={model.grandExpense.real}
          planned={model.grandExpense.planned}
          type="expense"
        />
        <PnlKpi
          icon={<LineChart className="size-4" />}
          label="Resultado neto"
          value={model.grandNet.real}
          planned={model.grandNet.planned}
          type="neutral"
          badge={
            <span className="rounded-full bg-[rgba(138,138,148,0.16)] px-2 py-0.5 text-[10px] font-bold text-[#8a8a94]">
              {netDeficit ? "déficit" : "superávit"}
            </span>
          }
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-[15px] font-bold">Vista multi-mes</CardTitle>
          <div className="inline-flex flex-none rounded-full border border-card-border bg-[#121219] p-1 text-xs font-bold">
            {([
              ["real", "Real"],
              ["mixto", "Mixto"],
              ["planned", "Presupuestado"],
            ] as const).map(([mode, modeLabel]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-1.5 transition",
                  viewMode === mode ? "bg-[#cdfa46] text-[#0a0a0f]" : "text-[#9a9aa6] hover:text-[#f4f4f7]",
                )}
              >
                {modeLabel}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table data-testid="table-pnl" className="[&_td]:py-2.5 [&_th]:h-auto [&_th]:py-2.5">
              <TableHeader>
                <TableRow className="border-[#1e1e26] hover:bg-transparent">
                  <TableHead className={cn(STICKY, "min-w-[200px] pl-5 text-[10px] uppercase tracking-wide text-[#6c6c78]")}>
                    Categoría
                  </TableHead>
                  {model.monthKeys.map((monthKey) => {
                    const [year, month] = monthKey.split("-");
                    const label = `${getMonthName(Number(month) - 1).slice(0, 3)} ${year}`;
                    const status = model.monthStatus[monthKey];
                    const mixed = status.real && status.planned;
                    const onlyPlanned = !status.real && status.planned;

                    return (
                      <TableHead key={monthKey} className="min-w-[150px] text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-mono text-xs text-[#cfcfd8]">{label}</span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                              mixed
                                ? "bg-[rgba(205,250,70,0.12)] text-[#cdfa46]"
                                : onlyPlanned
                                  ? "border border-card-border text-[#9a9aa6]"
                                  : "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]",
                            )}
                          >
                            {mixed ? "Mixto" : onlyPlanned ? "Proyección" : "Real"}
                          </span>
                        </div>
                      </TableHead>
                    );
                  })}
                  <TableHead className="min-w-[150px] pr-5 text-right text-[10px] uppercase tracking-wide text-[#6c6c78]">
                    Total
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Sección Ingresos (tinte lima) */}
                <TableRow className="bg-[rgba(205,250,70,0.05)] hover:bg-[rgba(205,250,70,0.05)]">
                  <TableCell className={cn(STICKY, "pl-5 text-xs font-bold uppercase tracking-wide text-[#cdfa46]")}>
                    Ingresos
                  </TableCell>
                  {model.monthKeys.map((monthKey) => (
                    <TableCell key={`income-spacer-${monthKey}`} />
                  ))}
                  <TableCell className="pr-5" />
                </TableRow>

                {model.incomeRows.map((row) => (
                  <TableRow key={`income-${row.category}`} className="border-[#1e1e26]">
                    <TableCell className={cn(STICKY, "pl-5 text-sm font-medium")}>{row.category}</TableCell>
                    {row.values.map((value, index) => (
                      <TableCell key={`${row.category}-${model.monthKeys[index]}`} className="align-top">
                        <PnlCell value={value} type="income" viewMode={viewMode} />
                      </TableCell>
                    ))}
                    <TableCell className="pr-5 align-top">
                      <PnlCell value={row.total} type="income" viewMode={viewMode} />
                    </TableCell>
                  </TableRow>
                ))}

                <TableRow className="border-t border-card-border bg-[rgba(205,250,70,0.04)] hover:bg-[rgba(205,250,70,0.04)]">
                  <TableCell className={cn(STICKY, "pl-5 text-sm font-bold")}>Total Ingresos</TableCell>
                  {model.incomeTotalsByMonth.map((value, index) => (
                    <TableCell key={`income-total-${model.monthKeys[index]}`} className="align-top">
                      <PnlCell value={value} type="income" viewMode={viewMode} />
                    </TableCell>
                  ))}
                  <TableCell className="pr-5 align-top">
                    <PnlCell value={model.grandIncome} type="income" viewMode={viewMode} />
                  </TableCell>
                </TableRow>

                {/* Sección Gastos (limpia) */}
                <TableRow className="hover:bg-transparent">
                  <TableCell className={cn(STICKY, "pl-5 text-xs font-bold uppercase tracking-wide text-[#f4f4f7]")}>
                    Gastos
                  </TableCell>
                  {model.monthKeys.map((monthKey) => (
                    <TableCell key={`expense-spacer-${monthKey}`} />
                  ))}
                  <TableCell className="pr-5" />
                </TableRow>

                {model.expenseRows.map((row) => (
                  <TableRow key={`expense-${row.category}`} className="border-[#1e1e26]">
                    <TableCell className={cn(STICKY, "pl-5 text-sm font-medium")}>{row.category}</TableCell>
                    {row.values.map((value, index) => (
                      <TableCell key={`${row.category}-${model.monthKeys[index]}`} className="align-top">
                        <PnlCell value={value} type="expense" viewMode={viewMode} />
                      </TableCell>
                    ))}
                    <TableCell className="pr-5 align-top">
                      <PnlCell value={row.total} type="expense" viewMode={viewMode} />
                    </TableCell>
                  </TableRow>
                ))}

                <TableRow className="border-t border-card-border bg-white/[0.03] hover:bg-white/[0.03]">
                  <TableCell className={cn(STICKY, "pl-5 text-sm font-bold")}>Total Gastos</TableCell>
                  {model.expenseTotalsByMonth.map((value, index) => (
                    <TableCell key={`expense-total-${model.monthKeys[index]}`} className="align-top">
                      <PnlCell value={value} type="expense" viewMode={viewMode} />
                    </TableCell>
                  ))}
                  <TableCell className="pr-5 align-top">
                    <PnlCell value={model.grandExpense} type="expense" viewMode={viewMode} />
                  </TableCell>
                </TableRow>

                {/* Resultado neto */}
                <TableRow className="border-t-2 border-card-border bg-secondary hover:bg-secondary">
                  <TableCell className={cn("sticky left-0 z-[1] bg-secondary pl-5 text-sm font-bold")}>
                    Resultado neto
                  </TableCell>
                  {model.netTotalsByMonth.map((value, index) => (
                    <TableCell key={`net-total-${model.monthKeys[index]}`} className="align-top">
                      <PnlCell value={value} type="neutral" viewMode={viewMode} />
                    </TableCell>
                  ))}
                  <TableCell className="pr-5 align-top">
                    <PnlCell value={model.grandNet} type="neutral" viewMode={viewMode} />
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
