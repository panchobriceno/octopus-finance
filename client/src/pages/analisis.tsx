import { useMemo } from "react";
import { PieChart as PieIcon } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCLP } from "@/lib/utils";
import { useTransactions } from "@/lib/hooks";
import { buildSpendingAnalysis, type SpendingAnalysis } from "@/domain/spending";

const LIME = "#cdfa46";
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const PIE = ["#cdfa46", "#9ae6b4", "#7dd3fc", "#c4b5fd", "#fcd34d", "#fda4af", "#94a3b8", "#67e8f9", "#f0abfc", "#a3e635"];
const WS_LABEL: Record<string, string> = { business: "Empresa", family: "Familia", dentist: "Consulta Javi", shared: "Compartido" };
const monthKeyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const mkLabel = (mk: string) => `${MESES[Number(mk.slice(5, 7)) - 1] ?? mk}`;

export default function AnalisisPage() {
  const transactions = useTransactions();
  const a = useMemo<SpendingAnalysis>(
    () => buildSpendingAnalysis(transactions.data ?? [], { monthKey: monthKeyLocal(), monthsBack: 6 }),
    [transactions.data],
  );
  const loading = !transactions.data;
  const trendData = a.trend.map((t) => ({ name: mkLabel(t.monthKey), monto: t.monto, current: t.monthKey === a.monthKey }));
  const pieData = a.byCategory.slice(0, 9);
  const otrosMonto = a.byCategory.slice(9).reduce((s, c) => s + c.monto, 0);
  if (otrosMonto > 0) pieData.push({ categoria: "Otras categorías", monto: otrosMonto });

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl border border-card-border bg-secondary text-[#cdfa46]"><PieIcon className="size-4" /></span>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Análisis de gastos</h2>
          <p className="mt-0.5 text-xs text-[#9a9aa6]">En qué se va la plata este mes ({mkLabel(a.monthKey)}) y cómo viene la tendencia.</p>
        </div>
      </div>

      {/* total + tendencia */}
      <Card className="border-card-border bg-secondary">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs text-[#9a9aa6]">Gasto del mes</div>
              <div className="font-mono text-3xl font-extrabold tabular-nums">{formatCLP(a.totalMes)}</div>
            </div>
            <div className="text-right text-xs text-[#9a9aa6]">
              {a.byWorkspace.map((w) => (
                <div key={w.workspace}>{WS_LABEL[w.workspace] ?? w.workspace}: <span className="font-mono">{formatCLP(w.monto)}</span></div>
              ))}
            </div>
          </div>
          <div className="mt-4 h-40">
            {loading ? <p className="text-sm text-[#9a9aa6]">Cargando…</p> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <XAxis dataKey="name" stroke="#6c6c78" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,.04)" }} contentStyle={{ background: "#15151c", border: "1px solid #262630", borderRadius: 10, fontSize: 12 }} formatter={(v: number) => [formatCLP(v), "Gasto"]} />
                  <Bar dataKey="monto" radius={[4, 4, 0, 0]}>
                    {trendData.map((d, i) => <Cell key={i} fill={d.current ? LIME : "#3a3a44"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* categorías */}
        <Card className="border-card-border bg-secondary">
          <CardHeader className="pb-2"><CardTitle className="text-base">Por categoría</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <div className="h-44 w-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="monto" nameKey="categoria" innerRadius={42} outerRadius={70} paddingAngle={2}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} stroke="none" />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#15151c", border: "1px solid #262630", borderRadius: 10, fontSize: 12 }} formatter={(v: number) => formatCLP(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {pieData.map((c, i) => (
                  <div key={`${c.categoria}-${i}`} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 truncate"><span className="size-2 shrink-0 rounded-full" style={{ background: PIE[i % PIE.length] }} />{c.categoria}</span>
                    <span className="font-mono tabular-nums text-[#cfcfd8]">{formatCLP(c.monto)}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* top comercios */}
        <Card className="border-card-border bg-secondary">
          <CardHeader className="pb-2"><CardTitle className="text-base">Top comercios del mes</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {a.topMerchants.length === 0 && <p className="text-sm text-[#9a9aa6]">Sin gastos este mes.</p>}
            {a.topMerchants.map((m, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-[#dcdce4]">{m.name}</span>
                <span className="shrink-0 font-mono tabular-nums">{formatCLP(m.monto)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
