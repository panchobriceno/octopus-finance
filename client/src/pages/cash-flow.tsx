import { useTransactions } from "@/lib/hooks";
import { formatCLP, getMonthName } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, Line, ComposedChart,
} from "recharts";
import { ArrowUpDown } from "lucide-react";

interface MonthlyFlow {
  month: string;
  monthKey: string;
  ingresos: number;
  gastos: number;
  neto: number;
  acumulado: number;
}

export default function CashFlowPage() {
  const { data: transactions = [], isLoading } = useTransactions();

  // Build monthly data
  const monthMap: Record<string, { ingresos: number; gastos: number }> = {};
  for (const tx of transactions) {
    const key = tx.date.substring(0, 7);
    if (!monthMap[key]) {
      monthMap[key] = { ingresos: 0, gastos: 0 };
    }
    if (tx.type === "income") {
      monthMap[key].ingresos += tx.amount;
    } else {
      monthMap[key].gastos += tx.amount;
    }
  }

  const sortedMonths = Object.keys(monthMap).sort();
  let acumulado = 0;
  const monthlyFlows: MonthlyFlow[] = sortedMonths.map((key) => {
    const [y, m] = key.split("-");
    const monthIdx = parseInt(m) - 1;
    const neto = monthMap[key].ingresos - monthMap[key].gastos;
    acumulado += neto;
    return {
      month: `${getMonthName(monthIdx).substring(0, 3)} ${y}`,
      monthKey: key,
      ingresos: monthMap[key].ingresos,
      gastos: monthMap[key].gastos,
      neto,
      acumulado,
    };
  });

  const totalIngresos = monthlyFlows.reduce((s, m) => s + m.ingresos, 0);
  const totalGastos = monthlyFlows.reduce((s, m) => s + m.gastos, 0);
  const totalNeto = totalIngresos - totalGastos;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
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

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            Flujo de Caja Mensual
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80" data-testid="chart-cashflow">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyFlows} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
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
                <Bar
                  dataKey="ingresos"
                  name="Ingresos"
                  fill="hsl(var(--chart-1))"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="gastos"
                  name="Gastos"
                  fill="hsl(var(--chart-3))"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="acumulado"
                  name="Acumulado"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: "hsl(var(--chart-2))" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Monthly Breakdown Table */}
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
                  <TableHead className="text-right">Ingresos</TableHead>
                  <TableHead className="text-right">Gastos</TableHead>
                  <TableHead className="text-right">Flujo Neto</TableHead>
                  <TableHead className="text-right pr-5">Acumulado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlyFlows.map((m) => (
                  <TableRow key={m.monthKey}>
                    <TableCell className="pl-5 font-medium text-sm">
                      {m.month}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-emerald-600 dark:text-emerald-400">
                      {formatCLP(m.ingresos)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-red-600 dark:text-red-400">
                      {formatCLP(m.gastos)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums text-sm font-medium ${
                        m.neto >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {formatCLP(m.neto)}
                    </TableCell>
                    <TableCell
                      className={`text-right pr-5 tabular-nums text-sm font-semibold ${
                        m.acumulado >= 0
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {formatCLP(m.acumulado)}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="border-t-2 border-border font-semibold bg-muted/50">
                  <TableCell className="pl-5 text-sm">Total</TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-emerald-600 dark:text-emerald-400">
                    {formatCLP(totalIngresos)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-red-600 dark:text-red-400">
                    {formatCLP(totalGastos)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums text-sm ${
                      totalNeto >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {formatCLP(totalNeto)}
                  </TableCell>
                  <TableCell className="pr-5" />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
