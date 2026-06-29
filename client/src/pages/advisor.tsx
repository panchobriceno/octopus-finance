import { useEffect, useMemo, useState } from "react";
import { Sparkles, RefreshCw, AlertTriangle, CalendarClock, FileWarning, Inbox, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useCommitmentInstances,
  useClientPayments,
  useImportBatches,
  useCreditCardSettings,
  useImportedMovements,
  useTransactions,
} from "@/lib/hooks";
import { buildAdvisorFacts, fetchAdvisor, type AdvisorFacts, type AdvisorReport, type Obligation } from "@/lib/advisor";

const CACHE_KEY = "octopus_advisor_report";
const clp = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
const fmtDate = (s: string) => { const m = (s || "").match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}` : s; };

function dueLabel(days: number): { text: string; cls: string } {
  if (days < 0) return { text: `Vencido hace ${Math.abs(days)}d`, cls: "bg-red-500/15 text-red-300 border-red-500/30" };
  if (days === 0) return { text: "Vence hoy", cls: "bg-red-500/15 text-red-300 border-red-500/30" };
  if (days <= 3) return { text: `En ${days}d`, cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" };
  return { text: `En ${days}d`, cls: "bg-white/5 text-[#cfc7dd]/70 border-white/10" };
}

export default function AdvisorPage() {
  const commitments = useCommitmentInstances();
  const clientPayments = useClientPayments();
  const importBatches = useImportBatches();
  const creditCards = useCreditCardSettings();
  const pendingMovs = useImportedMovements({ status: "pending", limitCount: 500 });
  const transactions = useTransactions();
  const { toast } = useToast();

  const [report, setReport] = useState<AdvisorReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { try { const c = localStorage.getItem(CACHE_KEY); if (c) setReport(JSON.parse(c)); } catch { /* ignore */ } }, []);

  const facts = useMemo<AdvisorFacts | null>(() => {
    if (!commitments.data || !clientPayments.data || !importBatches.data || !creditCards.data || !pendingMovs.data || !transactions.data) return null;
    return buildAdvisorFacts({
      commitments: commitments.data, clientPayments: clientPayments.data, importBatches: importBatches.data,
      creditCards: creditCards.data, pendingMovements: pendingMovs.data, transactions: transactions.data,
    });
  }, [commitments.data, clientPayments.data, importBatches.data, creditCards.data, pendingMovs.data, transactions.data]);

  const oblById = useMemo(() => new Map((facts?.obligations ?? []).map((o) => [o.id, o])), [facts]);

  // "pagar" = orden de la IA (solo IDs válidos) + obligaciones no mencionadas al final (nada real se oculta).
  const pagarList = useMemo<{ o: Obligation; razon?: string; prioridad?: string }[]>(() => {
    if (!facts) return [];
    const seen = new Set<string>();
    const out: { o: Obligation; razon?: string; prioridad?: string }[] = [];
    for (const p of report?.pagar ?? []) { const o = oblById.get(p.sourceId); if (o && !seen.has(o.id)) { seen.add(o.id); out.push({ o, razon: p.razon, prioridad: p.prioridad }); } }
    for (const o of facts.obligations) { if (!seen.has(o.id)) out.push({ o }); }
    return out;
  }, [facts, report, oblById]);

  const loadingData = !facts;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 text-[#ece5fc]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-[#2a213d] ring-1 ring-[#bb9eff]/24"><Sparkles className="size-5 text-[#d8c7ff]" /></div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Tu asesor</h1>
            <p className="text-sm text-[#aea8be]">Qué pagar, cuándo, y qué revisar. La IA sugiere; vos decidís.</p>
          </div>
        </div>
        <Button onClick={() => {
          if (!facts) return;
          setLoading(true);
          fetchAdvisor(facts)
            .then((r) => { setReport(r); try { localStorage.setItem(CACHE_KEY, JSON.stringify(r)); } catch { /* ignore */ } })
            .catch((e) => toast({ title: "No se pudo generar", description: e instanceof Error ? e.message : String(e), variant: "destructive" }))
            .finally(() => setLoading(false));
        }} disabled={loading || loadingData}>
          <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} /> {report ? "Actualizar" : "Generar recomendaciones"}
        </Button>
      </div>

      {report?.generatedAt && (
        <p className="mb-4 text-xs text-[#aea8be]">Última actualización: {new Date(report.generatedAt).toLocaleString("es-CL")}</p>
      )}

      {report?.resumen && (
        <Card className="mb-5 border-[#bb9eff]/20 bg-[#1a1430]"><CardContent className="pt-5 text-[15px] leading-relaxed text-[#e7ddff]">{report.resumen}</CardContent></Card>
      )}

      {/* Alertas (IA) */}
      {(report?.alertas?.length ?? 0) > 0 && (
        <Card className="mb-5 border-amber-500/20 bg-[#1a1430]">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-amber-300" /> Alertas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {report!.alertas.map((a, i) => (
              <div key={i} className="flex gap-2 text-sm"><span className={`mt-1 size-2 shrink-0 rounded-full ${a.severidad === "alta" ? "bg-red-400" : a.severidad === "media" ? "bg-amber-400" : "bg-white/30"}`} /><span className="text-[#e7ddff]">{a.texto}</span></div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Qué pagar y cuándo (números/fechas del código; orden/razón de la IA) */}
      <Card className="mb-5 bg-[#1a1430]">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="size-4 text-[#d8c7ff]" /> Qué pagar y cuándo</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {pagarList.length === 0 && <p className="text-sm text-[#aea8be]">No hay obligaciones próximas registradas.</p>}
          {pagarList.map(({ o, razon, prioridad }) => { const d = dueLabel(o.daysUntilDue); return (
            <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="truncate font-medium text-[#f1e9fc]">{o.label}</span>{prioridad === "alta" && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">PRIORIDAD</span>}</div>
                {razon && <p className="mt-0.5 truncate text-xs text-[#aea8be]">{razon}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-semibold tabular-nums text-[#f1e9fc]">{clp(o.amount)}</span>
                <span className={`rounded-md border px-2 py-0.5 text-[11px] ${d.cls}`} title={o.dueDate}>{d.text}</span>
              </div>
            </div>
          ); })}
        </CardContent>
      </Card>

      {/* Documentos faltantes (código, siempre visible) */}
      {(facts?.missingDocs?.length ?? 0) > 0 && (
        <Card className="mb-5 border-orange-500/20 bg-[#1a1430]">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><FileWarning className="size-4 text-orange-300" /> Documentos faltantes</CardTitle></CardHeader>
          <CardContent className="space-y-2">{facts!.missingDocs.map((m) => <p key={m.id} className="text-sm text-[#e7ddff]">• {m.texto}</p>)}</CardContent>
        </Card>
      )}

      {/* Por revisar (código + IA) */}
      <Card className="mb-5 bg-[#1a1430]">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Inbox className="size-4 text-[#d8c7ff]" /> Por revisar</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-[#e7ddff]">
          {facts && facts.review.pendingMovements > 0 && <p>• Tenés <b>{facts.review.pendingMovements}</b> movimientos en la bandeja sin revisar{facts.review.oldestPendingDate ? ` (el más antiguo del ${facts.review.oldestPendingDate})` : ""}.</p>}
          {(report?.revisar ?? []).map((r, i) => <p key={i}>• {r.texto}</p>)}
          {facts && facts.review.pendingMovements === 0 && (report?.revisar?.length ?? 0) === 0 && <p className="text-[#aea8be]">Nada pendiente de revisar.</p>}
        </CardContent>
      </Card>

      {/* Cambios de gasto (código) */}
      {(facts?.categoryDeltas?.length ?? 0) > 0 && (
        <Card className="mb-5 bg-[#1a1430]">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="size-4 text-[#d8c7ff]" /> Cambios de gasto vs mes anterior</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {facts!.categoryDeltas.map((d) => (
              <div key={d.categoria} className="flex items-center justify-between text-sm">
                <span className="text-[#e7ddff]">{d.categoria}</span>
                <span className={`tabular-nums ${d.delta > 0 ? "text-red-300" : "text-emerald-300"}`}>{d.delta > 0 ? "+" : ""}{clp(d.delta)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!report && (
        <p className="mt-2 text-center text-sm text-[#aea8be]">{loadingData ? "Cargando tus datos…" : "Apretá “Generar recomendaciones” para que la IA priorice y te avise qué hacer."}</p>
      )}
    </div>
  );
}
