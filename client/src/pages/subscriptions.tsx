import { useMemo } from "react";
import { Repeat, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCLP } from "@/lib/utils";
import { useCommitmentTemplates } from "@/lib/hooks";
import { buildSubscriptions, type SubsResult } from "@/domain/subscriptions";

const LIME = "#cdfa46";
const WS_LABEL: Record<string, string> = { business: "Empresa", family: "Familia", dentist: "Consulta Javi", shared: "Compartido" };

export default function SubscriptionsPage() {
  const templates = useCommitmentTemplates();
  const r = useMemo<SubsResult>(
    () => buildSubscriptions(templates.data ?? []),
    [templates.data],
  );
  const loading = !templates.data;

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl border border-card-border bg-secondary text-[#cdfa46]"><Repeat className="size-4" /></span>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Radar de suscripciones</h2>
          <p className="mt-0.5 text-xs text-[#9a9aa6]">Todo lo recurrente junto. Dónde se te va la plata mes a mes y qué se solapa.</p>
        </div>
      </div>

      {/* total */}
      <Card className="border-card-border bg-secondary">
        <CardContent className="flex flex-wrap items-end justify-between gap-4 pt-5">
          <div>
            <div className="text-xs text-[#9a9aa6]">Suscripciones por mes</div>
            <div className="font-mono text-3xl font-extrabold tabular-nums">{formatCLP(r.totalMes)}</div>
            <div className="mt-0.5 text-[11px] text-[#9a9aa6]">{r.items.length} suscripciones · {formatCLP(r.totalAnual)} al año</div>
          </div>
          <div className="text-right text-xs text-[#9a9aa6]">
            {r.byWorkspace.map((w) => (
              <div key={w.workspace}>{WS_LABEL[w.workspace] ?? w.workspace}: <span className="font-mono">{formatCLP(w.monto)}</span></div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* solapamientos */}
      {r.overlaps.length > 0 && (
        <Card className="border-amber-500/30 bg-secondary">
          <CardContent className="space-y-2 pt-5">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-300"><AlertTriangle className="size-4" /> Posibles solapamientos (¿recortás?)</div>
            {r.overlaps.map((o) => (
              <div key={o.tipo} className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                <span className="text-amber-200"><b>{o.tipo}</b>: {o.items.map((i) => i.name).join(" + ")}</span>
                <span className="font-mono font-bold text-amber-300">{formatCLP(o.sum)}/mes</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* lista */}
      <Card className="border-card-border bg-secondary">
        <CardContent className="pt-5">
          {loading && <p className="text-sm text-[#9a9aa6]">Cargando…</p>}
          {!loading && r.items.length === 0 && <p className="text-sm text-[#9a9aa6]">No hay suscripciones cargadas en tus compromisos.</p>}
          <div className="divide-y divide-card-border">
            {r.items.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#9a9aa6]">
                    <span className="rounded border border-card-border bg-background/40 px-1.5 py-0.5">{s.tipo}</span>
                    <span>{WS_LABEL[s.workspace] ?? s.workspace}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-bold tabular-nums">{formatCLP(s.amount)}</div>
                  <div className="text-[10px] text-[#9a9aa6]">{formatCLP(s.amount * 12)}/año</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
