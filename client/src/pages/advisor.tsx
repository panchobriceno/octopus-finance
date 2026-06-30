import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Inbox,
  TrendingUp,
  FileText,
  CreditCard,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/utils";
import { openImportWizard } from "@/lib/import-wizard";
import {
  useCommitmentInstances,
  useClientPayments,
  useImportBatches,
  useCreditCardSettings,
  useImportedMovements,
  useTransactions,
  useResolveDuplicateTransaction,
} from "@/lib/hooks";
import {
  buildAdvisorFacts,
  fetchAdvisor,
  type AdvisorFacts,
  type AdvisorReport,
  type DupTx,
  type DuplicatePair,
} from "@/lib/advisor";
import { FinancialCalendar } from "@/components/finance/financial-calendar";

const CACHE_KEY = "octopus_advisor_report";
const LIME = "#cdfa46";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-06-26" -> "26 jun" (para fechas cortas en cards de duplicados). */
const fmtShortDate = (s: string) => {
  const m = (s || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]?.slice(0, 3) ?? m[2]}`;
};

/** ISO -> "29-06-2026 · 13:40" para el pill "Actualizado". */
const fmtUpdated = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* ============================ Piezas de presentación ============================ */

/** Card de módulo: gradiente grafito + borde + radio 20px. Header con ícono + título + badge/acción. */
function ModuleCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[20px] border border-[#262630] p-[22px_18px] sm:p-[22px_24px] ${className}`}
      style={{ background: "linear-gradient(180deg,#17171f,#131319)" }}
    >
      {children}
    </div>
  );
}

function CardHead({ icon, title, badge, action }: { icon: ReactNode; title: string; badge?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <div className="flex items-center gap-[9px]">
        {icon}
        <span className="text-[14px] font-bold sm:text-[15px]">{title}</span>
        {badge}
      </div>
      {action}
    </div>
  );
}

/** Badge lima (números altos) o gris (neutral). */
function CountBadge({ value, tone }: { value: number; tone: "lime" | "muted" }) {
  if (tone === "lime")
    return <span className="ml-0.5 rounded-full bg-[#cdfa46] px-2 py-0.5 text-[10px] font-bold text-[#0a0a0f]">{value}</span>;
  return <span className="ml-0.5 rounded-full border border-[#2c2c38] bg-[#1f1f28] px-2 py-0.5 text-[10px] font-bold text-[#cfcfd8]">{value}</span>;
}

/** Chip de stat del resumen: cifra mono + label de 2 líneas. */
function StatChip({ value, label, tone }: { value: number; label: ReactNode; tone: "lime" | "muted" }) {
  return (
    <div
      className={`flex items-center gap-[10px] rounded-[13px] bg-[#101016] px-[15px] py-[11px] ${tone === "lime" ? "border border-[#2a2a34]" : "border border-[#26262f]"}`}
    >
      <div
        className="font-mono text-[19px] font-extrabold tabular-nums sm:text-[22px]"
        style={{ color: tone === "lime" ? LIME : "#e3e3ea" }}
      >
        {value}
      </div>
      <div className="text-[10.5px] font-semibold leading-[1.2] text-[#9a9aa6] sm:text-[11.5px]">{label}</div>
    </div>
  );
}

/** Fila de alerta (escritorio): barra de severidad + chip + texto. */
function AlertRow({ severity, text }: { severity: "critica" | "media"; text: string }) {
  const critical = severity === "critica";
  return (
    <div
      className="mb-[10px] flex gap-[13px] rounded-[14px] p-[14px] last:mb-0"
      style={
        critical
          ? { background: "rgba(205,250,70,.045)", border: "1px solid rgba(205,250,70,.16)" }
          : { background: "#101016", border: "1px solid #24242e" }
      }
    >
      <div
        className="w-1 shrink-0 self-stretch rounded-full"
        style={critical ? { background: LIME, boxShadow: "0 0 10px rgba(205,250,70,.4)" } : { background: "#3a3a44" }}
      />
      <div className="min-w-0">
        <div className="mb-[5px]">
          {critical ? (
            <span className="rounded-[5px] bg-[#cdfa46] px-[7px] py-0.5 text-[9.5px] font-bold tracking-[.06em] text-[#0a0a0f]">CRÍTICA</span>
          ) : (
            <span className="rounded-[5px] border border-[#2c2c38] bg-[#1f1f28] px-[7px] py-0.5 text-[9.5px] font-bold tracking-[.06em] text-[#9a9aa6]">MEDIA</span>
          )}
        </div>
        <div className="text-[13.5px] font-medium leading-[1.5] text-[#dcdce4]">{text}</div>
      </div>
    </div>
  );
}

/** Tarjeta cuadrada de alerta (móvil, carrusel 1a). */
function AlertCard({ severity, text }: { severity: "critica" | "media"; text: string }) {
  const critical = severity === "critica";
  return (
    <div className="snap-start flex h-[212px] w-[226px] shrink-0 flex-col overflow-hidden rounded-[18px] border border-[#24242e] bg-[#13131a]">
      <div className="h-1" style={critical ? { background: LIME, boxShadow: "0 0 12px rgba(205,250,70,.5)" } : { background: "#3a3a44" }} />
      <div className="flex h-full flex-col p-[16px]">
        {critical ? (
          <span className="self-start rounded-[5px] bg-[#cdfa46] px-2 py-[3px] text-[9px] font-bold tracking-[.07em] text-[#0a0a0f]">CRÍTICA</span>
        ) : (
          <span className="self-start rounded-[5px] border border-[#2c2c38] bg-[#1f1f28] px-2 py-[3px] text-[9px] font-bold tracking-[.07em] text-[#9a9aa6]">MEDIA</span>
        )}
        <div className="mt-[10px] line-clamp-5 text-[12px] font-medium leading-[1.45] text-[#cfcfd8]">{text}</div>
      </div>
    </div>
  );
}

/** Tarjeta de duplicado (par A vs B). Conserva el modelo de pares + confirmación. */
function DuplicateCard({ pair, onDelete }: { pair: DuplicatePair; onDelete: (tx: DupTx, keep: DupTx) => void }) {
  const { a, b } = pair;
  const name = a.name || b.name || "Movimiento";
  const dates = a.date === b.date ? fmtShortDate(a.date) : `${fmtShortDate(a.date)} y ${fmtShortDate(b.date)}`;
  return (
    <div className="rounded-[14px] border border-[#24242e] bg-[#101016] p-[14px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-[#f4f4f7]">{name}</div>
          <div className="mt-0.5 text-[11px] font-medium text-[#7a7a86]">{dates} · 2 fuentes</div>
        </div>
        <div className="shrink-0 font-mono text-[14px] font-bold tabular-nums text-[#e3e3ea]">{formatCLP(a.amount)}</div>
      </div>
      <div className="mt-[13px] grid grid-cols-2 gap-2">
        <button
          onClick={() => onDelete(b, a)}
          className="rounded-[8px] bg-[#cdfa46] py-[7px] text-center text-[11.5px] font-bold text-[#0a0a0f] hover-elevate active-elevate-2"
          title={`Conservar ${a.date} · ${a.source}`}
        >
          Es el de {fmtShortDate(a.date)}
        </button>
        <button
          onClick={() => onDelete(a, b)}
          className="rounded-[8px] border border-[#2c2c38] bg-[#1b1b22] py-[7px] text-center text-[11.5px] font-bold text-[#cfcfd8] hover-elevate active-elevate-2"
          title={`Conservar ${b.date} · ${b.source}`}
        >
          Es el de {fmtShortDate(b.date)}
        </button>
      </div>
    </div>
  );
}

/** Fila de documento faltante. */
function MissingDocRow({ texto, onUpload }: { texto: string; onUpload: () => void }) {
  return (
    <div className="mb-[11px] flex items-center gap-[13px] rounded-[13px] border border-[#24242e] bg-[#101016] p-[13px] last:mb-0">
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] border border-[#2c2c38]" style={{ background: "rgba(154,154,166,.1)" }}>
        <CreditCard className="size-[17px] text-[#9a9aa6]" strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium leading-snug text-[#f4f4f7]">{texto}</div>
      </div>
      <button onClick={onUpload} className="shrink-0 rounded-md px-1.5 text-[11.5px] font-bold hover-elevate" style={{ color: LIME }}>
        Subir →
      </button>
    </div>
  );
}

const sparkleSm = <Sparkles className="size-[18px]" style={{ color: LIME }} strokeWidth={2} />;

/* ================================== Página ================================== */

export default function AdvisorPage() {
  const [, navigate] = useLocation();
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

  useEffect(() => {
    try {
      const c = localStorage.getItem(CACHE_KEY);
      if (c) setReport(JSON.parse(c));
    } catch {
      /* ignore */
    }
  }, []);

  const facts = useMemo<AdvisorFacts | null>(() => {
    if (!commitments.data || !clientPayments.data || !importBatches.data || !creditCards.data || !pendingMovs.data || !transactions.data) return null;
    return buildAdvisorFacts({
      commitments: commitments.data,
      clientPayments: clientPayments.data,
      importBatches: importBatches.data,
      creditCards: creditCards.data,
      pendingMovements: pendingMovs.data,
      transactions: transactions.data,
    });
  }, [commitments.data, clientPayments.data, importBatches.data, creditCards.data, pendingMovs.data, transactions.data]);


  const loadingData = !facts;

  // Conteos derivados de la data real (no inventados).
  const alertas = report?.alertas ?? [];
  const sev = (a: { severidad?: string }): "critica" | "media" => (a.severidad === "alta" ? "critica" : "media");
  const criticas = alertas.filter((a) => sev(a) === "critica").length;
  const dupCount = facts?.duplicates.length ?? 0;
  const sinRevisar = facts?.review.pendingMovements ?? 0;
  const docsFaltantes = facts?.missingDocs.length ?? 0;

  const monthLabel = useMemo(() => {
    const d = new Date();
    return `${MESES[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
  }, []);

  // Sugerencia del asesor, derivada de los hechos (qué hacer primero).
  const tip = useMemo(() => {
    if (!facts) return "";
    const steps: string[] = [];
    if (dupCount > 0) steps.push(`Empezá por los ${dupCount} duplicados: limpiarlos baja los gastos sobreestimados antes del cierre.`);
    if (docsFaltantes > 0) steps.push(`Subí ${docsFaltantes === 1 ? "el EECC pendiente" : `los ${docsFaltantes} EECC pendientes`} para cuadrar el saldo de tarjetas.`);
    if (sinRevisar > 0 && steps.length < 2) steps.push(`Revisá los ${sinRevisar} movimientos de la bandeja para que el mes quede completo.`);
    return steps.slice(0, 2).join(" Luego, ");
  }, [facts, dupCount, docsFaltantes, sinRevisar]);

  const runRefresh = () => {
    if (!facts) return;
    setLoading(true);
    fetchAdvisor(facts)
      .then((r) => {
        setReport(r);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(r));
        } catch {
          /* ignore */
        }
      })
      .catch((e) => toast({ title: "No se pudo generar", description: e instanceof Error ? e.message : String(e), variant: "destructive" }))
      .finally(() => setLoading(false));
  };

  const refreshLabel = loading ? "Analizando…" : report ? "Actualizar" : "Generar recomendaciones";
  const goBandeja = () => navigate("/movements");

  /* ---- Bloques reutilizados entre escritorio y móvil ---- */

  const summaryCard = (
    <div
      className="relative overflow-hidden rounded-[22px] border border-[#24242e] p-[18px] sm:p-[24px_26px]"
      style={{ background: "linear-gradient(135deg,#15151d 0%,#101016 100%)" }}
    >
      <div className="pointer-events-none absolute -right-8 -top-16 size-60 rounded-full" style={{ background: "radial-gradient(circle,rgba(205,250,70,.07),transparent 70%)" }} />
      <div className="mb-[10px] text-[9.5px] font-bold tracking-[.1em] sm:mb-3 sm:text-[10.5px] sm:tracking-[.12em]" style={{ color: LIME }}>
        RESUMEN DEL MES · {monthLabel}
      </div>
      {report?.resumen ? (
        <div className="max-w-[880px] text-[14px] font-medium leading-[1.55] text-[#dcdce4] sm:text-[17px]">{report.resumen}</div>
      ) : (
        <div className="text-[14px] font-medium leading-[1.55] text-[#9a9aa6] sm:text-[17px]">
          {loadingData ? "Cargando tus datos…" : "Apretá “Generar recomendaciones” para que la IA priorice y te avise qué hacer primero este mes."}
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-[9px] sm:mt-[22px] sm:flex sm:flex-wrap sm:gap-3">
        <StatChip value={criticas} tone="lime" label={<>Alertas<br />críticas</>} />
        <StatChip value={dupCount} tone="lime" label={<>Posibles<br />duplicados</>} />
        <StatChip value={sinRevisar} tone="muted" label={<>Sin revisar<br />en bandeja</>} />
        <StatChip value={docsFaltantes} tone="muted" label={<>Documentos<br />faltantes</>} />
      </div>
    </div>
  );

  const alertIcon = <AlertTriangle className="size-[18px]" style={{ color: LIME }} strokeWidth={2} />;

  const porRevisarBody = (
    <>
      <div className="mb-4 text-[13px] font-medium text-[#9a9aa6]">
        {sinRevisar > 0 ? (
          <>
            Tenés <b className="font-bold" style={{ color: LIME }}>{sinRevisar} movimientos</b> sin revisar
            {facts?.review.oldestPendingDate ? ` (el más antiguo del ${facts.review.oldestPendingDate})` : ""}.
            {dupCount > 0 ? <> Estos {dupCount} aparecen <b className="text-[#cfcfd8]">duplicados en dos fuentes</b> — confirmá cuál es el real.</> : null}
          </>
        ) : dupCount > 0 ? (
          <>Hay {dupCount} posibles duplicados en dos fuentes — confirmá cuál es el real.</>
        ) : (
          <span className="text-[#9a9aa6]">Nada pendiente de revisar.</span>
        )}
      </div>
      {dupCount > 0 && (
        <div className="grid grid-cols-1 gap-[11px] sm:grid-cols-2">
          {facts!.duplicates.map((pair, i) => (
            <DuplicateCard key={i} pair={pair} onDelete={(tx, keep) => setPendingDel({ tx, keep })} />
          ))}
        </div>
      )}
    </>
  );

  const docsBody = (facts?.missingDocs ?? []).map((m) => <MissingDocRow key={m.id} texto={m.texto} onUpload={openImportWizard} />);

  const advisorTip = report && tip ? (
    <div
      className="rounded-[20px] border border-[#262630] p-[20px_22px]"
      style={{ background: "radial-gradient(120% 120% at 0% 0%,rgba(205,250,70,.08),#101016 60%)" }}
    >
      <div className="mb-[9px] flex items-center gap-2">
        <Sparkles className="size-[15px]" style={{ color: LIME }} strokeWidth={1.9} />
        <span className="text-[12.5px] font-bold" style={{ color: LIME }}>Sugerencia del asesor</span>
      </div>
      <div className="text-[13px] font-medium leading-[1.55] text-[#b4b4be]">{tip}</div>
    </div>
  ) : null;

  const deltasCard = (facts?.categoryDeltas?.length ?? 0) > 0 ? (
    <ModuleCard>
      <CardHead icon={<TrendingUp className="size-[18px]" style={{ color: LIME }} strokeWidth={2} />} title="Cambios de gasto vs mes anterior" />
      <div className="space-y-1.5">
        {facts!.categoryDeltas.map((d) => (
          <div key={d.categoria} className="flex items-center justify-between text-[13px]">
            <span className="text-[#dcdce4]">{d.categoria}</span>
            <span className="font-mono tabular-nums" style={{ color: d.delta > 0 ? "#f4f4f7" : LIME }}>
              {d.delta > 0 ? "+" : ""}{formatCLP(d.delta)}
            </span>
          </div>
        ))}
      </div>
    </ModuleCard>
  ) : null;

  return (
    <div className="flex h-full flex-col" style={{ background: "radial-gradient(120% 70% at 50% -10%,#101016,#050507)" }}>
      {/* Header sticky */}
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#18181f] bg-[#0a0a0f]/60 px-4 py-4 backdrop-blur-md sm:px-7 sm:py-5">
        <div className="flex min-w-0 items-start gap-[14px]">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-[12px] sm:size-[42px] sm:rounded-[13px]"
            style={{ background: "radial-gradient(120% 120% at 30% 20%,rgba(205,250,70,.22),rgba(205,250,70,.05))", border: "1px solid rgba(205,250,70,.28)", boxShadow: "0 0 22px rgba(205,250,70,.12)" }}
          >
            <Sparkles className="size-[18px] sm:size-[21px]" style={{ color: LIME }} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-[10px]">
              <h2 className="whitespace-nowrap text-[20px] font-extrabold tracking-[-.02em] sm:text-[24px]">Tu asesor</h2>
              <span className="rounded-full px-2 py-[3px] text-[9.5px] font-bold tracking-[.08em]" style={{ color: LIME, background: "rgba(205,250,70,.1)", border: "1px solid rgba(205,250,70,.22)" }}>IA</span>
            </div>
            <p className="mt-1 text-[12px] text-[#8a8a96] sm:text-[13px]">Qué pagar, cuándo, y qué revisar. La IA sugiere; vos decidís.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-[10px]">
          {report?.generatedAt && (
            <div className="hidden items-center gap-[7px] rounded-full border border-[#22222b] bg-[#121219] px-[13px] py-2 text-[11.5px] font-semibold text-[#7a7a86] lg:flex">
              <span className="size-1.5 rounded-full" style={{ background: LIME, boxShadow: "0 0 8px #cdfa46" }} />
              Actualizado {fmtUpdated(report.generatedAt)}
            </div>
          )}
          <Button onClick={runRefresh} disabled={loading || loadingData} className="font-bold" style={{ boxShadow: "0 6px 20px rgba(205,250,70,.2)" }}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{refreshLabel}</span>
          </Button>
        </div>
      </header>

      {/* Cuerpo scrolleable */}
      <div className="flex-1 space-y-[18px] overflow-y-auto px-4 py-[18px] sm:px-7 sm:py-6">
        {summaryCard}

        {/* Calendario financiero — reemplaza "Qué pagar y cuándo" (full width) */}
        <FinancialCalendar />

        {/* ===== ESCRITORIO: grid 2 columnas ===== */}
        <div className="hidden lg:grid lg:grid-cols-[1.55fr_1fr] lg:items-start lg:gap-[18px]">
          <div className="flex min-w-0 flex-col gap-[18px]">
            {alertas.length > 0 && (
              <ModuleCard>
                <CardHead icon={alertIcon} title="Alertas" badge={<CountBadge value={alertas.length} tone="lime" />} />
                {alertas.map((a, i) => <AlertRow key={i} severity={sev(a)} text={a.texto} />)}
              </ModuleCard>
            )}
            <ModuleCard>
              <CardHead
                icon={<Inbox className="size-[18px] text-[#cfcfd8]" strokeWidth={2} />}
                title="Por revisar"
                action={
                  <button onClick={goBandeja} className="flex items-center gap-[6px] rounded-md px-1 text-[12px] font-semibold hover-elevate" style={{ color: LIME }}>
                    Abrir bandeja <ChevronRight className="size-[13px]" strokeWidth={2.2} />
                  </button>
                }
              />
              {porRevisarBody}
            </ModuleCard>
          </div>

          <div className="flex min-w-0 flex-col gap-[18px]">
            {docsFaltantes > 0 && (
              <ModuleCard>
                <CardHead icon={<FileText className="size-[18px] text-[#cfcfd8]" strokeWidth={1.9} />} title="Documentos faltantes" badge={<CountBadge value={docsFaltantes} tone="muted" />} />
                {docsBody}
              </ModuleCard>
            )}
            {advisorTip}
          </div>
        </div>

        {/* ===== MÓVIL: una columna ===== */}
        <div className="space-y-0 lg:hidden">
          {/* Alertas: carrusel horizontal */}
          {alertas.length > 0 && (
            <>
              <div className="mb-3 mt-[22px] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {alertIcon}
                  <span className="text-[14px] font-bold">Alertas</span>
                  <CountBadge value={alertas.length} tone="lime" />
                </div>
                {alertas.length > 1 && <span className="text-[11px] text-[#6c6c78]">desliza ›</span>}
              </div>
              <div className="-mx-4 flex snap-x snap-mandatory gap-[13px] overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {alertas.map((a, i) => <AlertCard key={i} severity={sev(a)} text={a.texto} />)}
              </div>
            </>
          )}

          {/* Por revisar */}
          <div className="mb-2 mt-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="size-[18px] text-[#cfcfd8]" strokeWidth={2} />
              <span className="text-[14px] font-bold">Por revisar</span>
            </div>
            <button onClick={goBandeja} className="rounded-md px-1 text-[11px] font-semibold hover-elevate" style={{ color: LIME }}>Bandeja ›</button>
          </div>
          {porRevisarBody}

          {/* Documentos faltantes */}
          {docsFaltantes > 0 && (
            <>
              <div className="mb-3 mt-6 flex items-center gap-2">
                <FileText className="size-[18px] text-[#cfcfd8]" strokeWidth={1.9} />
                <span className="text-[14px] font-bold">Documentos faltantes</span>
                <CountBadge value={docsFaltantes} tone="muted" />
              </div>
              {docsBody}
            </>
          )}

          {/* Sugerencia */}
          {advisorTip && <div className="mt-[18px]">{advisorTip}</div>}
        </div>

        {/* Cambios de gasto (full width, ambos viewports) */}
        {deltasCard}

        {!report && !loadingData && (
          <p className="text-center text-[13px] text-[#9a9aa6]">Apretá “Generar recomendaciones” para que la IA priorice y te avise qué hacer.</p>
        )}
      </div>

      {/* Confirmación de borrado de duplicado (flujo intacto) */}
      <AlertDialog open={!!pendingDel} onOpenChange={(o) => { if (!o) setPendingDel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Borrar transacción duplicada</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDel && (
                <>
                  Se va a <b>BORRAR</b>: {pendingDel.tx.name} — {pendingDel.tx.date}, {formatCLP(pendingDel.tx.amount)}.<br />
                  Se conserva: {pendingDel.keep.name} ({pendingDel.keep.date}). Esto no se puede deshacer.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const t = pendingDel?.tx;
                if (!t) return;
                resolveDup
                  .mutateAsync(t.id)
                  .then(() => toast({ title: "Duplicado borrado", description: `${t.name} (${formatCLP(t.amount)})` }))
                  .catch((e) => toast({ title: "No se pudo borrar", description: e instanceof Error ? e.message : String(e), variant: "destructive" }))
                  .finally(() => setPendingDel(null));
              }}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
