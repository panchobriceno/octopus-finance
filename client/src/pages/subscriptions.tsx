import { useMemo, type ReactNode } from "react";
import { Repeat, AlertTriangle } from "lucide-react";
import { formatCLP } from "@/lib/utils";
import { useCommitmentTemplates } from "@/lib/hooks";
import { buildSubscriptions, type SubsResult } from "@/domain/subscriptions";

const LIME = "#cdfa46";
const WS_LABEL: Record<string, string> = { business: "Empresa", family: "Familia", dentist: "Consulta Javi", shared: "Compartido" };

/* ============================ Piezas de presentación (estilo "Tu asesor") ============================ */

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

function CardHead({ icon, title, badge }: { icon: ReactNode; title: string; badge?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-[9px]">
      {icon}
      <span className="text-[14px] font-bold sm:text-[15px]">{title}</span>
      {badge}
    </div>
  );
}

function CountBadge({ value, tone }: { value: number; tone: "lime" | "muted" }) {
  if (tone === "lime")
    return <span className="ml-0.5 rounded-full bg-[#cdfa46] px-2 py-0.5 text-[10px] font-bold text-[#0a0a0f]">{value}</span>;
  return <span className="ml-0.5 rounded-full border border-[#2c2c38] bg-[#1f1f28] px-2 py-0.5 text-[10px] font-bold text-[#cfcfd8]">{value}</span>;
}

/** Chip de resumen: cifra mono + label de 2 líneas (igual que el asesor). */
function StatChip({ value, label, tone = "muted" }: { value: string; label: ReactNode; tone?: "lime" | "muted" }) {
  return (
    <div className="flex items-center gap-[10px] rounded-[13px] border border-[#26262f] bg-[#101016] px-[15px] py-[11px]">
      <div className="font-mono text-[17px] font-extrabold tabular-nums sm:text-[19px]" style={{ color: tone === "lime" ? LIME : "#e3e3ea" }}>{value}</div>
      <div className="text-[10.5px] font-semibold leading-[1.2] text-[#9a9aa6] sm:text-[11.5px]">{label}</div>
    </div>
  );
}

const TIPO_HINT: Record<string, string> = {
  IA: "Inteligencia artificial",
  Streaming: "Streaming / video",
  Apple: "Servicios Apple",
  Diseño: "Diseño / creatividad",
  Otro: "Otro",
};

/* ================================== Página ================================== */

export default function SubscriptionsPage() {
  const templates = useCommitmentTemplates();
  const r = useMemo<SubsResult>(() => buildSubscriptions(templates.data ?? []), [templates.data]);
  const loading = !templates.data;

  return (
    <div className="flex h-full flex-col" style={{ background: "radial-gradient(120% 70% at 50% -10%,#101016,#050507)" }}>
      {/* Header sticky */}
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#18181f] bg-[#0a0a0f]/60 px-4 py-4 backdrop-blur-md sm:px-7 sm:py-5">
        <div className="flex min-w-0 items-start gap-[14px]">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-[12px] sm:size-[42px] sm:rounded-[13px]"
            style={{ background: "radial-gradient(120% 120% at 30% 20%,rgba(205,250,70,.22),rgba(205,250,70,.05))", border: "1px solid rgba(205,250,70,.28)", boxShadow: "0 0 22px rgba(205,250,70,.12)" }}
          >
            <Repeat className="size-[18px] sm:size-[21px]" style={{ color: LIME }} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h2 className="whitespace-nowrap text-[20px] font-extrabold tracking-[-.02em] sm:text-[24px]">Radar de suscripciones</h2>
            <p className="mt-1 text-[12px] text-[#8a8a96] sm:text-[13px]">Todo lo recurrente junto. Dónde se te va la plata mes a mes y qué se solapa.</p>
          </div>
        </div>
        {!loading && (
          <div className="hidden items-center gap-[7px] rounded-full border border-[#22222b] bg-[#121219] px-[13px] py-2 text-[11.5px] font-semibold text-[#7a7a86] lg:flex">
            <span className="size-1.5 rounded-full" style={{ background: LIME, boxShadow: "0 0 8px #cdfa46" }} />
            {r.items.length} activas
          </div>
        )}
      </header>

      {/* Cuerpo scrolleable */}
      <div className="flex-1 space-y-[18px] overflow-y-auto px-4 py-[18px] sm:px-7 sm:py-6">
        {/* Resumen */}
        <div className="relative overflow-hidden rounded-[22px] border border-[#24242e] p-[18px] sm:p-[24px_26px]" style={{ background: "linear-gradient(135deg,#15151d 0%,#101016 100%)" }}>
          <div className="pointer-events-none absolute -right-8 -top-16 size-60 rounded-full" style={{ background: "radial-gradient(circle,rgba(205,250,70,.07),transparent 70%)" }} />
          <div className="mb-[10px] text-[9.5px] font-bold tracking-[.12em]" style={{ color: LIME }}>SUSCRIPCIONES · TOTAL MENSUAL</div>
          <div className="font-mono text-[34px] font-extrabold tabular-nums leading-none sm:text-[40px]">{formatCLP(r.totalMes)}</div>
          <div className="mt-4 grid grid-cols-2 gap-[9px] sm:mt-[22px] sm:flex sm:flex-wrap sm:gap-3">
            <StatChip value={formatCLP(r.totalAnual)} label={<>Al<br />año</>} tone="lime" />
            <StatChip value={String(r.items.length)} label={<>Suscrip-<br />ciones</>} />
            {r.byWorkspace.map((w) => (
              <StatChip key={w.workspace} value={formatCLP(w.monto)} label={WS_LABEL[w.workspace] ?? w.workspace} />
            ))}
          </div>
        </div>

        {/* Solapamientos */}
        {r.overlaps.length > 0 && (
          <ModuleCard>
            <CardHead
              icon={<AlertTriangle className="size-[18px]" style={{ color: LIME }} strokeWidth={2} />}
              title="Posibles solapamientos (¿recortás?)"
              badge={<CountBadge value={r.overlaps.length} tone="lime" />}
            />
            {r.overlaps.map((o) => (
              <div
                key={o.tipo}
                className="mb-[10px] flex items-center justify-between gap-3 rounded-[14px] p-[14px] last:mb-0"
                style={{ background: "rgba(205,250,70,.045)", border: "1px solid rgba(205,250,70,.16)" }}
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold text-[#f4f4f7]">{o.tipo}</div>
                  <div className="mt-0.5 truncate text-[12px] text-[#9a9aa6]">{o.items.map((i) => i.name).join(" + ")}</div>
                </div>
                <div className="shrink-0 font-mono text-[15px] font-extrabold tabular-nums" style={{ color: LIME }}>{formatCLP(o.sum)}<span className="text-[11px] font-medium text-[#7a7a86]">/mes</span></div>
              </div>
            ))}
          </ModuleCard>
        )}

        {/* Lista */}
        <ModuleCard>
          <CardHead
            icon={<Repeat className="size-[18px] text-[#cfcfd8]" strokeWidth={2} />}
            title="Todas las suscripciones"
            badge={<CountBadge value={r.items.length} tone="muted" />}
          />
          {loading && <p className="text-[13px] text-[#9a9aa6]">Cargando…</p>}
          {!loading && r.items.length === 0 && <p className="text-[13px] text-[#9a9aa6]">No hay suscripciones cargadas en tus compromisos.</p>}
          <div className="divide-y divide-[#20202a]">
            {r.items.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-[11px]">
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold text-[#f4f4f7]">{s.name}</div>
                  <div className="mt-[3px] flex items-center gap-[7px] text-[11px] text-[#8a8a96]">
                    <span className="rounded-[5px] border border-[#2c2c38] bg-[#1f1f28] px-[7px] py-0.5 font-semibold text-[#cfcfd8]" title={TIPO_HINT[s.tipo]}>{s.tipo}</span>
                    <span>{WS_LABEL[s.workspace] ?? s.workspace}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[14px] font-bold tabular-nums text-[#f4f4f7]">{formatCLP(s.amount)}</div>
                  <div className="text-[10px] text-[#6c6c78]">{formatCLP(s.amount * 12)}/año</div>
                </div>
              </div>
            ))}
          </div>
        </ModuleCard>
      </div>
    </div>
  );
}
