import { useEffect, useMemo, useState } from "react";
import { Sparkles, RefreshCw, AlertTriangle, CalendarClock, FileWarning, Inbox, TrendingUp, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/utils";
import {
  useCommitmentInstances,
  useClientPayments,
  useImportBatches,
  useCreditCardSettings,
  useImportedMovements,
  useTransactions,
  useResolveDuplicateTransaction,
} from "@/lib/hooks";
import { buildAdvisorFacts, fetchAdvisor, type AdvisorFacts, type AdvisorReport, type DupTx, type Obligation } from "@/lib/advisor";

const CACHE_KEY = "octopus_advisor_report";
const fmtDate = (s: string) => { const m = (s || "").match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}` : s; };
const LIME = "#cdfa46";

function dueLabel(days: number): { text: string; cls: string } {
  if (days < 0) return { text: `Vencido hace ${Math.abs(days)}d`, cls: "border-red-500/40 bg-red-500/10 text-red-400" };
  if (days === 0) return { text: "Vence hoy", cls: "border-red-500/40 bg-red-500/10 text-red-400" };
  if (days <= 3) return { text: `En ${days}d`, cls: "border-amber-500/40 bg-amber-500/10 text-amber-400" };
  return { text: `En ${days}d`, cls: "border-card-border bg-secondary text-[#9a9aa6]" };
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
  const resolveDup = useResolveDuplicateTransaction();
  const [pendingDel, setPendingDel] = useState<{ tx: DupTx; keep: DupTx } | null>(null);

  useEffect(() => { try { const c = localStorage.getItem(CACHE_KEY); if (c) setReport(JSON.parse(c)); } catch { /* ignore */ } }, []);

  const facts = useMemo<AdvisorFacts | null>(() => {
    if (!commitments.data || !clientPayments.data || !importBatches.data || !creditCards.data || !pendingMovs.data || !transactions.data) return null;
    return buildAdvisorFacts({
      commitments: commitments.data, clientPayments: clientPayments.data, importBatches: importBatches.data,
      creditCards: creditCards.data, pendingMovements: pendingMovs.data, transactions: transactions.data,
    });
  }, [commitments.data, clientPayments.data, importBatches.data, creditCards.data, pendingMovs.data, transactions.data]);

  const oblById = useMemo(() => new Map((facts?.obligations ?? []).map((o) => [o.id, o])), [facts]);
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
    <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl border border-card-border bg-secondary text-[#cdfa46]"><Sparkles className="size-4" /></span>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight">Tu asesor</h2>
            <p className="mt-0.5 text-xs text-[#9a9aa6]">Qué pagar, cuándo, y qué revisar. La IA sugiere; vos decidís.{report?.generatedAt ? ` · Última: ${new Date(report.generatedAt).toLocaleString("es-CL")}` : ""}</p>
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

      {report?.resumen && (
        <Card className="border-card-border bg-secondary"><CardContent className="pt-5 text-[15px] leading-relaxed">{report.resumen}</CardContent></Card>
      )}

      {(report?.alertas?.length ?? 0) > 0 && (
        <Card className="border-card-border bg-secondary">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-amber-400" /> Alertas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {report!.alertas.map((a, i) => (
              <div key={i} className="flex gap-2 text-sm"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${a.severidad === "alta" ? "bg-red-400" : a.severidad === "media" ? "bg-amber-400" : "bg-[#9a9aa6]"}`} /><span>{a.texto}</span></div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-card-border bg-secondary">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="size-4" style={{ color: LIME }} /> Qué pagar y cuándo</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {pagarList.length === 0 && <p className="text-sm text-[#9a9aa6]">No hay obligaciones próximas registradas.</p>}
          {pagarList.map(({ o, razon, prioridad }) => { const d = dueLabel(o.daysUntilDue); return (
            <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-background/40 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="truncate font-medium">{o.label}</span>{prioridad === "alta" && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">PRIORIDAD</span>}</div>
                {razon && <p className="mt-0.5 truncate text-xs text-[#9a9aa6]">{razon}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-sm tabular-nums">{formatCLP(o.amount)}</span>
                <span className={`rounded-md border px-2 py-0.5 text-[11px] ${d.cls}`} title={o.dueDate}>{d.text}</span>
              </div>
            </div>
          ); })}
        </CardContent>
      </Card>

      {(facts?.missingDocs?.length ?? 0) > 0 && (
        <Card className="border-card-border bg-secondary">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><FileWarning className="size-4 text-orange-400" /> Documentos faltantes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">{facts!.missingDocs.map((m) => <p key={m.id}>• {m.texto}</p>)}</CardContent>
        </Card>
      )}

      <Card className="border-card-border bg-secondary">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Inbox className="size-4" style={{ color: LIME }} /> Por revisar</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {facts && facts.review.pendingMovements > 0 && <p>• Tenés <b style={{ color: LIME }}>{facts.review.pendingMovements}</b> movimientos en la bandeja sin revisar{facts.review.oldestPendingDate ? ` (el más antiguo del ${facts.review.oldestPendingDate})` : ""}.</p>}
          {(report?.revisar ?? []).map((r, i) => <p key={i}>• {r.texto}</p>)}
          {facts && facts.review.pendingMovements === 0 && (report?.revisar?.length ?? 0) === 0 && <p className="text-[#9a9aa6]">Nada pendiente de revisar.</p>}
        </CardContent>
      </Card>

      {(facts?.duplicates?.length ?? 0) > 0 && (
        <Card className="border-red-500/30 bg-secondary">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Copy className="size-4 text-red-400" /> Posibles duplicados</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-[#9a9aa6]">Mismo monto, misma categoría y fechas cercanas. Revisá y borrá el que sobra; se conserva el otro.</p>
            {facts!.duplicates.map((pair, i) => (
              <div key={i} className="rounded-lg border border-card-border bg-background/40 p-3">
                {[pair.a, pair.b].map((t, idx) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm">{t.name}</div>
                      <div className="text-xs text-[#9a9aa6]">{t.date} · {t.category} · {t.source}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm tabular-nums">{formatCLP(t.amount)}</span>
                      <Button size="sm" variant="outline" className="h-7 border-red-500/40 text-red-400 hover:bg-red-500/10" onClick={() => setPendingDel({ tx: t, keep: idx === 0 ? pair.b : pair.a })}>Borrar este</Button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(facts?.categoryDeltas?.length ?? 0) > 0 && (
        <Card className="border-card-border bg-secondary">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="size-4" style={{ color: LIME }} /> Cambios de gasto vs mes anterior</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {facts!.categoryDeltas.map((d) => (
              <div key={d.categoria} className="flex items-center justify-between text-sm">
                <span>{d.categoria}</span>
                <span className={`font-mono tabular-nums ${d.delta > 0 ? "text-red-400" : "text-emerald-400"}`}>{d.delta > 0 ? "+" : ""}{formatCLP(d.delta)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!report && (
        <p className="text-center text-sm text-[#9a9aa6]">{loadingData ? "Cargando tus datos…" : "Apretá “Generar recomendaciones” para que la IA priorice y te avise qué hacer."}</p>
      )}

      <AlertDialog open={!!pendingDel} onOpenChange={(o) => { if (!o) setPendingDel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Borrar transacción duplicada</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDel && (<>Se va a <b>BORRAR</b>: {pendingDel.tx.name} — {pendingDel.tx.date}, {formatCLP(pendingDel.tx.amount)}.<br />Se conserva: {pendingDel.keep.name} ({pendingDel.keep.date}). Esto no se puede deshacer.</>)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                const t = pendingDel?.tx; if (!t) return;
                resolveDup.mutateAsync(t.id)
                  .then(() => toast({ title: "Duplicado borrado", description: `${t.name} (${formatCLP(t.amount)})` }))
                  .catch((e) => toast({ title: "No se pudo borrar", description: e instanceof Error ? e.message : String(e), variant: "destructive" }))
                  .finally(() => setPendingDel(null));
              }}
            >Borrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
