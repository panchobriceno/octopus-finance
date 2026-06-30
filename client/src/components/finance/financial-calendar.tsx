/**
 * Calendario financiero — cruza obligaciones (egresos, CommitmentInstance) con pagos de
 * clientes (ingresos, ClientPayment) y proyecta la caja día a día sobre el mes elegido.
 * Reemplaza la sección "Qué pagar y cuándo". Paleta mono + lima (sin rojo/verde):
 * lima = entra, gris = sale; los estados de riesgo se marcan con forma + ícono.
 * El CÓDIGO es dueño de montos/fechas; "Marcar pagado" muta vía usePayCommitmentInstance.
 */
import { useMemo, useState } from "react";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, ArrowDown, ArrowUp, TrendingUp, Clock, AlertTriangle, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/utils";
import {
  useCommitmentInstances,
  useClientPayments,
  usePayCommitmentInstance,
} from "@/lib/hooks";
import { useOpeningBalance } from "@/lib/monthly-balances";
import type { CommitmentInstance, ClientPayment } from "@shared/schema";

const LIME = "#cdfa46";
const GRAY = "#cfcfd8";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DOW_SHORT = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const DOW_FULL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

type Ambito = "business" | "family" | "dentist" | "shared";
const AMB: Record<Ambito, { c: string; l: string }> = {
  business: { c: "#c8c8d2", l: "Empresa" },
  family: { c: "#9ea6b4", l: "Familia" },
  dentist: { c: "#7c7c88", l: "Consulta Javi" },
  shared: { c: "#b0b0bc", l: "Compartido" },
};

type Resolved = "pagado" | "recibido" | "proyectado" | "pendiente" | "porvencer" | "vencido";
const BADGE: Record<Resolved, { t: string; c: string; bg: string; bd: string }> = {
  pagado: { t: "Pagado", c: LIME, bg: "rgba(205,250,70,.1)", bd: "rgba(205,250,70,.22)" },
  recibido: { t: "Recibido", c: LIME, bg: "rgba(205,250,70,.1)", bd: "rgba(205,250,70,.22)" },
  proyectado: { t: "Proyectado", c: "#8a8a94", bg: "#1f1f28", bd: "#2c2c38" },
  pendiente: { t: "Pendiente", c: "#9a9aa6", bg: "#1f1f28", bd: "#2c2c38" },
  porvencer: { t: "Vence pronto", c: GRAY, bg: "#202028", bd: "#3a3a44" },
  vencido: { t: "Vencido", c: "#0a0a0f", bg: LIME, bd: LIME },
};

type CalEvent = {
  id: string;
  srcId: string;
  kind: "in" | "out";
  day: number;
  dateStr: string;
  name: string;
  cat: string;
  ambito: Ambito;
  amount: number;
  est: boolean;
  method: string;
  rawStatus: string;
  payMethod?: string;
  accountId?: string | null;
  creditCardName?: string | null;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const dayOf = (s: string) => Number((s || "").slice(8, 10)) || 0;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/** "$1.234.567" con signo y sin decimales (formatCLP ya da el formato CLP). */
const fmtSigned = (n: number, kind: "in" | "out") => `${kind === "in" ? "+" : "−"}${formatCLP(Math.abs(n))}`;
/** Abreviado para chips/strip: "$2,5M" / "$517k". */
const fmtChip = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(a / 1e6).toFixed(1).replace(".", ",")}M`;
  if (a >= 1000) return `$${Math.round(a / 1000)}k`;
  return `$${a}`;
};
const fmtShort = (n: number) => `${n < 0 ? "−" : ""}${fmtChip(n)}`;

const methodLabel = (m: string | null | undefined) =>
  m === "credit_card" ? "tarjeta" : m === "cash" ? "efectivo" : m === "bank_account" ? "cuenta" : "transferencia";

function StatusPill({ s, className = "", style = {} }: { s: Resolved; className?: string; style?: React.CSSProperties }) {
  const b = BADGE[s];
  return (
    <span
      className={`inline-block rounded-[5px] border px-[7px] py-0.5 text-[9px] font-bold ${className}`}
      style={{ color: b.c, background: b.bg, borderColor: b.bd, ...style }}
    >
      {b.t}
    </span>
  );
}

export function FinancialCalendar({ className = "" }: { className?: string }) {
  const commitments = useCommitmentInstances();
  const clientPayments = useClientPayments();
  const pay = usePayCommitmentInstance();
  const { toast } = useToast();

  const [view, setView] = useState<"cal" | "list" | "time">("cal");
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [filters, setFilters] = useState<{ ambito: "all" | Ambito; tipo: "all" | "in" | "out"; estado: "all" | "pend" | "paid" | "venc" }>({
    ambito: "all",
    tipo: "all",
    estado: "all",
  });

  // Mes mostrado (a partir de hoy + offset).
  const base = new Date();
  const monthDate = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth(); // 0-index
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (new Date(year, month, 1).getDay() + 6) % 7; // lunes-first
  const today = todayISO();
  const isCurrentMonth = year === base.getFullYear() && month === base.getMonth();
  const todayDay = isCurrentMonth ? base.getDate() : -1;

  const startBalance = useOpeningBalance(monthKey).amount ?? 0;

  // Estado resuelto de un evento (mismo criterio que el handoff).
  const resolve = (e: CalEvent): Resolved => {
    if (e.kind === "in") return e.rawStatus === "paid" ? "recibido" : "proyectado";
    if (e.rawStatus === "paid") return "pagado";
    const diff = daysBetween(e.dateStr, today);
    if (diff < 0) return "vencido";
    if (diff <= 3) return "porvencer";
    return "pendiente";
  };

  // Construye todos los eventos del mes (sin filtrar).
  const allEvents = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = [];
    for (const c of (commitments.data ?? []) as CommitmentInstance[]) {
      if (c.status === "skipped") continue;
      const d = c.dueDate || "";
      if (d.slice(0, 7) !== monthKey) continue;
      if (!(Number(c.expectedAmount) > 0)) continue;
      out.push({
        id: `c:${c.id}`,
        srcId: c.id,
        kind: "out",
        day: dayOf(d),
        dateStr: d,
        name: c.name,
        cat: c.category || "—",
        ambito: (c.workspace as Ambito) in AMB ? (c.workspace as Ambito) : "business",
        amount: Number(c.expectedAmount) || 0,
        est: c.amountMode === "variable",
        method: methodLabel(c.paymentMethod),
        rawStatus: c.status,
        payMethod: c.paymentMethod,
        accountId: c.accountId,
        creditCardName: c.creditCardName,
      });
    }
    for (const p of (clientPayments.data ?? []) as ClientPayment[]) {
      if (p.status === "cancelled") continue;
      const d = p.expectedDate || p.dueDate || "";
      if (d.slice(0, 7) !== monthKey) continue;
      if (!(Number(p.totalAmount) > 0)) continue;
      out.push({
        id: `p:${p.id}`,
        srcId: p.id,
        kind: "in",
        day: dayOf(d),
        dateStr: d,
        name: p.clientName || "Pago de cliente",
        cat: p.serviceItem || "Ventas",
        ambito: (p.workspace as Ambito) in AMB ? (p.workspace as Ambito) : "business",
        amount: Number(p.totalAmount) || 0,
        est: false,
        method: "transferencia",
        rawStatus: p.status,
      });
    }
    return out;
  }, [commitments.data, clientPayments.data, monthKey]);

  const events = useMemo(() => {
    return allEvents.filter((e) => {
      if (filters.ambito !== "all" && e.ambito !== filters.ambito) return false;
      if (filters.tipo === "in" && e.kind !== "in") return false;
      if (filters.tipo === "out" && e.kind !== "out") return false;
      if (filters.estado !== "all") {
        const s = resolve(e);
        if (filters.estado === "pend" && !(s === "pendiente" || s === "porvencer" || s === "proyectado")) return false;
        if (filters.estado === "paid" && !(s === "pagado" || s === "recibido")) return false;
        if (filters.estado === "venc" && s !== "vencido") return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEvents, filters, today]);

  // Saldo proyectado acumulado por día (1..daysInMonth).
  const bal = useMemo(() => {
    const b: number[] = [];
    let run = startBalance;
    for (let d = 1; d <= daysInMonth; d++) {
      for (const e of events) if (e.day === d) run += e.kind === "in" ? e.amount : -e.amount;
      b[d] = run;
    }
    return b;
  }, [events, startBalance, daysInMonth]);

  const firstNegDay = useMemo(() => {
    for (let d = 1; d <= daysInMonth; d++) if (bal[d] < 0) return d;
    return null;
  }, [bal, daysInMonth]);
  const recoverEvent = useMemo(() => (firstNegDay == null ? null : events.find((e) => e.kind === "in" && e.day >= firstNegDay) ?? null), [events, firstNegDay]);

  // Totales.
  const ins = events.filter((e) => e.kind === "in");
  const outs = events.filter((e) => e.kind === "out");
  const sumIn = ins.reduce((a, e) => a + e.amount, 0);
  const sumOut = outs.reduce((a, e) => a + e.amount, 0);
  const net = sumIn - sumOut;
  const weekIn = isCurrentMonth ? ins.filter((e) => e.day >= todayDay && e.day < todayDay + 7).reduce((a, e) => a + e.amount, 0) : 0;
  const weekOut = isCurrentMonth ? outs.filter((e) => e.day >= todayDay && e.day < todayDay + 7).reduce((a, e) => a + e.amount, 0) : 0;

  // Grilla de semanas (lunes-first).
  type Cell = { day: number; flag: boolean; isToday: boolean; vis: CalEvent[]; more: number } | null;
  const weeks = useMemo(() => {
    const cells: Cell[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dayEvs = events.filter((e) => e.day === d);
      cells.push({
        day: d,
        flag: dayEvs.some((e) => resolve(e) === "vencido"),
        isToday: d === todayDay,
        vis: dayEvs.slice(0, 2),
        more: dayEvs.length > 2 ? dayEvs.length - 2 : 0,
      });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const w: Cell[][] = [];
    for (let i = 0; i < cells.length; i += 7) w.push(cells.slice(i, i + 7));
    return w;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, lead, daysInMonth, todayDay, today]);

  // Agrupación por semana (vista Lista/Timeline + mini agenda mobile usa días).
  const weekGroups = useMemo(() => {
    const groups: { label: string; net: number; items: CalEvent[] }[] = [];
    weeks.forEach((wk, i) => {
      const days = wk.filter(Boolean).map((c) => (c as NonNullable<Cell>).day);
      if (!days.length) return;
      const items = events.filter((e) => e.day >= days[0] && e.day <= days[days.length - 1]).sort((a, b) => a.day - b.day);
      if (!items.length) return;
      const gNet = items.reduce((a, e) => a + (e.kind === "in" ? e.amount : -e.amount), 0);
      groups.push({ label: `Semana ${i + 1} · ${days[0]}–${days[days.length - 1]} ${MESES[month].slice(0, 3)}`, net: gNet, items });
    });
    return groups;
  }, [weeks, events, month]);

  const upcoming = useMemo(
    () => [...events].filter((e) => (isCurrentMonth ? e.day >= todayDay : true)).sort((a, b) => a.day - b.day).slice(0, 5),
    [events, isCurrentMonth, todayDay],
  );

  const monthLabel = `${MESES[month][0].toUpperCase()}${MESES[month].slice(1)} ${year}`;

  const onPay = (e: CalEvent) => {
    pay
      .mutateAsync({
        id: e.srcId,
        data: { date: today, amount: e.amount, paymentMethod: e.payMethod, accountId: e.accountId ?? null, creditCardName: e.creditCardName ?? null },
      })
      .then(() => toast({ title: "Marcado como pagado", description: `${e.name} (${formatCLP(e.amount)})` }))
      .catch((err) => toast({ title: "No se pudo marcar", description: err instanceof Error ? err.message : String(err), variant: "destructive" }));
  };

  const loading = !commitments.data || !clientPayments.data;

  /* ---------- sub-render: chip de evento (celda) ---------- */
  const EventChip = ({ e }: { e: CalEvent }) => {
    const col = e.kind === "in" ? LIME : GRAY;
    return (
      <div
        className="flex items-center gap-1 rounded-[5px] px-[5px] py-0.5 text-[9.5px] font-semibold text-[#cfcfd8]"
        style={{ background: "#101016", border: e.est ? "1px dashed #3a3a44" : "1px solid #20202a" }}
      >
        <span className="size-[5px] shrink-0 rounded-[2px]" style={{ background: col }} />
        <span className="min-w-0 flex-1 truncate">{e.name}</span>
        <span className="shrink-0 font-mono" style={{ color: col }}>{fmtChip(e.amount)}</span>
      </div>
    );
  };

  /* ---------- sub-render: barra de filtros (segmented) ---------- */
  const Seg = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className="flex items-center whitespace-nowrap rounded-[6px] px-[11px] py-[6px] text-[11.5px] font-semibold transition-colors"
      style={active ? { background: LIME, color: "#0a0a0f" } : { background: "transparent", color: "#9a9aa6" }}
    >
      {children}
    </button>
  );
  const SegBox = ({ children }: { children: React.ReactNode }) => (
    <div className="flex rounded-[9px] border border-[#22222b] bg-[#121219] p-[3px]">{children}</div>
  );
  const dot = (c: string) => <span className="mr-[6px] inline-block size-[7px] rounded-[2px]" style={{ background: c }} />;

  /* ---------- sub-render: panel del día (desktop) ---------- */
  const dayEvents = selectedDay ? events.filter((e) => e.day === selectedDay).sort((a, b) => a.day - b.day) : [];
  const dayPanel =
    selectedDay != null ? (
      <div>
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[18px] font-extrabold">{DOW_FULL[new Date(year, month, selectedDay).getDay()]} {selectedDay} {MESES[month].slice(0, 3)}</div>
          <button onClick={() => setSelectedDay(null)} className="flex size-7 items-center justify-center rounded-[8px] border border-[#26262f] bg-[#15151c] text-[#9a9aa6] hover-elevate">
            <X className="size-3.5" strokeWidth={2.2} />
          </button>
        </div>
        <div className="mb-4 flex gap-2">
          <div className="flex-1 rounded-[10px] border border-[#20202a] bg-[#101016] px-[11px] py-[9px]">
            <div className="text-[10px] font-semibold text-[#8a8a96]">Sale</div>
            <div className="mt-[3px] font-mono text-[14px] font-bold" style={{ color: GRAY }}>{formatCLP(dayEvents.filter((e) => e.kind === "out").reduce((a, e) => a + e.amount, 0))}</div>
          </div>
          <div className="flex-1 rounded-[10px] border border-[#20202a] bg-[#101016] px-[11px] py-[9px]">
            <div className="text-[10px] font-semibold text-[#8a8a96]">Entra</div>
            <div className="mt-[3px] font-mono text-[14px] font-bold" style={{ color: LIME }}>{formatCLP(dayEvents.filter((e) => e.kind === "in").reduce((a, e) => a + e.amount, 0))}</div>
          </div>
          <div className="flex-1 rounded-[10px] border border-[#20202a] bg-[#101016] px-[11px] py-[9px]">
            <div className="text-[10px] font-semibold text-[#8a8a96]">Saldo</div>
            <div className="mt-[3px] font-mono text-[14px] font-bold" style={{ color: bal[selectedDay] < 0 ? LIME : GRAY }}>{formatCLP(bal[selectedDay] ?? 0)}</div>
          </div>
        </div>
        {dayEvents.length === 0 && <div className="py-[30px] text-center text-[12.5px] font-medium text-[#6c6c78]">Sin movimientos este día.</div>}
        {dayEvents.map((e) => {
          const s = resolve(e);
          const payable = e.kind === "out" && s !== "pagado";
          return (
            <div key={e.id} className="mb-[9px] rounded-[12px] border border-[#20202a] bg-[#101016] p-[13px]">
              <div className="flex items-start justify-between gap-[10px]">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold">{e.name}</div>
                  <div className="mt-[3px] flex items-center gap-[7px] text-[11px] font-medium text-[#8a8a96]">{dot(AMB[e.ambito].c)}{AMB[e.ambito].l} · {e.method}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[14px] font-bold tabular-nums" style={{ color: e.kind === "in" ? LIME : GRAY }}>{fmtSigned(e.amount, e.kind)}</div>
                  {e.est && <div className="mt-0.5 text-[9px] font-semibold" style={{ color: LIME }}>~ estimado</div>}
                </div>
              </div>
              <div className="mt-[11px] flex items-center justify-between">
                <StatusPill s={s} />
                {s === "pagado" ? (
                  <span className="flex items-center gap-[5px] text-[11.5px] font-bold" style={{ color: LIME }}><Check className="size-[13px]" strokeWidth={2.6} /> Pagado</span>
                ) : payable ? (
                  <button onClick={() => onPay(e)} disabled={pay.isPending} className="shrink-0 whitespace-nowrap rounded-[8px] px-[13px] py-[6px] text-[11.5px] font-bold text-[#0a0a0f] hover-elevate active-elevate-2" style={{ background: LIME }}>
                    Marcar pagado
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div>
        <div className="mb-1 text-[16px] font-extrabold">Esta semana</div>
        <div className="mb-4 text-[12px] font-medium text-[#8a8a96]">Tocá un día del calendario para ver el detalle y marcar pagos.</div>
        <div className="mb-3 rounded-[13px] border border-[#20202a] bg-[#101016] p-[15px]">
          <div className="mb-[6px] flex items-center justify-between"><span className="text-[12px] font-semibold" style={{ color: GRAY }}>Pagás</span><span className="font-mono text-[15px] font-bold" style={{ color: GRAY }}>{formatCLP(weekOut)}</span></div>
          <div className="flex items-center justify-between"><span className="text-[12px] font-semibold" style={{ color: LIME }}>Entra</span><span className="font-mono text-[15px] font-bold" style={{ color: LIME }}>{formatCLP(weekIn)}</span></div>
        </div>
        <div className="mx-0.5 mb-[9px] mt-[6px] text-[11px] font-bold tracking-[.04em] text-[#8a8a96]">PRÓXIMOS A VENCER</div>
        {upcoming.length === 0 && <div className="text-[12px] text-[#6c6c78]">Nada próximo este mes.</div>}
        {upcoming.map((e) => (
          <button key={e.id} onClick={() => setSelectedDay(e.day)} className="mb-[7px] flex w-full items-center gap-[10px] rounded-[10px] border border-[#20202a] bg-[#101016] px-[11px] py-[9px] text-left hover-elevate">
            <div className="w-[34px] shrink-0 text-center"><div className="font-mono text-[13px] font-bold" style={{ color: GRAY }}>{e.day}</div><div className="text-[8px] font-semibold text-[#6c6c78]">{MESES[month].slice(0, 3)}</div></div>
            <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-semibold">{e.name}</div><div className="mt-0.5"><StatusPill s={resolve(e)} /></div></div>
            <div className="shrink-0 font-mono text-[12.5px] font-bold" style={{ color: e.kind === "in" ? LIME : GRAY }}>{fmtSigned(e.amount, e.kind)}</div>
          </button>
        ))}
      </div>
    );

  /* ---------- balance strip ---------- */
  const balStrip = (() => {
    const maxAbs = Math.max(1, ...Array.from({ length: daysInMonth }, (_, i) => Math.abs(bal[i + 1] ?? 0)));
    const ticks = Array.from(new Set([1, 5, 10, 15, 20, 25, daysInMonth].filter((t) => t <= daysInMonth)));
    return (
      <div className="mt-[14px] rounded-[14px] border border-[#1e1e26] bg-[#0d0d12] px-4 pb-[10px] pt-[14px]">
        <div className="mb-[10px] flex items-center justify-between">
          <div className="text-[12px] font-bold" style={{ color: GRAY }}>Saldo proyectado por día</div>
          <div className="text-[11px] font-medium text-[#7a7a86]">arranca en {formatCLP(startBalance)} · cierra en <span className="font-mono" style={{ color: (bal[daysInMonth] ?? 0) < 0 ? LIME : GRAY }}>{formatCLP(bal[daysInMonth] ?? 0)}</span></div>
        </div>
        <div className="relative flex h-[88px] items-stretch gap-[2px]">
          <div className="absolute left-0 right-0 top-[54px] border-t border-dashed border-[#3a3a44]" />
          {Array.from({ length: daysInMonth }, (_, i) => {
            const v = bal[i + 1] ?? 0;
            const h = Math.round((Math.abs(v) / maxAbs) * 100);
            const posH = v >= 0 ? Math.max(3, h * 0.5) : 0;
            const negH = v < 0 ? Math.max(3, h * 0.3) : 0;
            return (
              <div key={i} className="relative flex flex-1 flex-col" title={`${i + 1} ${MESES[month].slice(0, 3)} · ${formatCLP(v)}`}>
                <div className="flex h-[54px] flex-col justify-end">
                  <div style={{ width: "100%", borderRadius: "3px 3px 0 0", background: v >= 0 ? LIME : "transparent", height: `${posH}px`, opacity: v >= 0 ? (i + 1 <= todayDay ? 0.95 : 0.6) : 1 }} />
                </div>
                <div className="h-[34px]">
                  <div style={{ width: "100%", borderRadius: "0 0 3px 3px", background: "#0a0a0f", border: v < 0 ? `1px solid ${LIME}` : "none", height: `${negH}px` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-[6px] flex justify-between font-mono text-[9px] text-[#5a5a66]">
          {ticks.map((t) => <span key={t}>{t}</span>)}
        </div>
      </div>
    );
  })();

  /* ---------- vista Lista/Timeline ---------- */
  const listView = (
    <div>
      {weekGroups.length === 0 && <div className="py-8 text-center text-[13px] text-[#6c6c78]">No hay movimientos este mes con los filtros actuales.</div>}
      {weekGroups.map((g, gi) => (
        <div key={gi} className="mb-[18px]">
          <div className="mb-[9px] flex items-center gap-[9px]">
            <div className="text-[12px] font-bold" style={{ color: LIME }}>{g.label}</div>
            <div className="h-px flex-1 bg-[#1e1e26]" />
            <div className="font-mono text-[11px] font-semibold text-[#8a8a96]">{g.net >= 0 ? "+" : ""}{formatCLP(g.net)}</div>
          </div>
          {g.items.map((e) => (
            <button key={e.id} onClick={() => { setView("cal"); setSelectedDay(e.day); }} className="mb-[7px] flex w-full items-center gap-3 rounded-[11px] border border-[#20202a] bg-[#101016] px-3 py-[11px] text-left hover-elevate">
              <div className="w-[42px] shrink-0 text-center"><div className="font-mono text-[15px] font-bold" style={{ color: GRAY }}>{e.day}</div><div className="text-[9px] font-semibold text-[#6c6c78]">{DOW_SHORT[(new Date(year, month, e.day).getDay() + 6) % 7]}</div></div>
              <div className="h-[30px] w-px shrink-0 bg-[#22222b]" />
              <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold">{e.name}</div><div className="mt-0.5 flex items-center gap-[7px] text-[11px] font-medium text-[#8a8a96]">{dot(AMB[e.ambito].c)}{AMB[e.ambito].l} · {e.cat}</div></div>
              <div className="shrink-0 text-right"><div className="font-mono text-[13px] font-bold tabular-nums" style={{ color: e.kind === "in" ? LIME : GRAY }}>{fmtSigned(e.amount, e.kind)}</div><div className="mt-[3px]"><StatusPill s={resolve(e)} /></div></div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  /* ---------- mini-mes (mobile) ---------- */
  const miniMonth = (
    <div className="rounded-[14px] border border-[#1e1e26] bg-[#0d0d12] px-[11px] pb-[13px] pt-[11px]">
      <div className="mb-1 grid grid-cols-7 gap-[2px]">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <div key={i} className="text-center text-[8px] font-bold text-[#6c6c78]">{d}</div>)}
      </div>
      {weeks.map((wk, wi) => (
        <div key={wi} className="grid grid-cols-7 gap-[2px]">
          {wk.map((c, ci) => {
            if (!c) return <div key={ci} className="h-[30px]" />;
            const dayEvs = events.filter((e) => e.day === c.day);
            const col = dayEvs.some((e) => e.kind === "in") ? LIME : dayEvs.some((e) => e.kind === "out") ? "#8a8a94" : "transparent";
            return (
              <button key={ci} onClick={() => setSelectedDay(c.day)} className="relative flex h-[30px] items-center justify-center rounded-[7px] font-mono text-[11px]" style={{ color: c.isToday ? "#0a0a0f" : GRAY, background: c.isToday ? LIME : "transparent" }}>
                {c.day}
                <span className="absolute bottom-[3px] left-1/2 size-1 -translate-x-1/2 rounded-full" style={{ background: col }} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  /* ---------- agenda (mobile) ---------- */
  const agendaDays = useMemo(() => {
    const byDay = new Map<number, CalEvent[]>();
    events.filter((e) => (isCurrentMonth ? e.day >= todayDay : true)).forEach((e) => {
      const arr = byDay.get(e.day) ?? [];
      arr.push(e);
      byDay.set(e.day, arr);
    });
    return Array.from(byDay.keys()).sort((a, b) => a - b).map((d) => ({ day: d, items: byDay.get(d)! }));
  }, [events, isCurrentMonth, todayDay]);

  const mobileAgenda = (
    <div>
      <div className="mx-0.5 mb-[10px] mt-2 text-[11px] font-bold tracking-[.04em] text-[#8a8a96]">AGENDA · DESDE HOY</div>
      {agendaDays.length === 0 && <div className="text-[12.5px] text-[#6c6c78]">Sin movimientos próximos este mes.</div>}
      {agendaDays.map(({ day, items }) => {
        const dt = new Date(year, month, day);
        const isToday = day === todayDay;
        return (
          <div key={day} className="mb-[14px]">
            <div className="mb-2 flex items-center gap-[9px]">
              <div className="text-[12.5px] font-bold" style={{ color: isToday ? LIME : GRAY }}>{isToday ? `Hoy · ${day} ${MESES[month].slice(0, 3)}` : `${DOW_SHORT[(dt.getDay() + 6) % 7].slice(0, 3)} ${day} ${MESES[month].slice(0, 3)}`}</div>
              <div className="h-px flex-1 bg-[#1a1a22]" />
              <div className="font-mono text-[10.5px]" style={{ color: (bal[day] ?? 0) < 0 ? LIME : "#8a8a96" }}>saldo {fmtShort(bal[day] ?? 0)}</div>
            </div>
            {items.map((e) => {
              const s = resolve(e);
              const payable = e.kind === "out" && s !== "pagado";
              return (
                <div key={e.id} className="mb-[7px] flex items-center gap-[11px] rounded-[12px] border border-[#20202a] bg-[#101016] px-3 py-[10px]">
                  <div className="h-[34px] w-[6px] shrink-0 rounded-full" style={{ background: e.kind === "in" ? LIME : GRAY }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{e.name}</div>
                    <div className="mt-0.5 flex items-center gap-[6px] text-[10.5px] font-medium text-[#8a8a96]">{dot(AMB[e.ambito].c)}{AMB[e.ambito].l}<StatusPill s={s} style={{ marginLeft: 2, fontSize: 8, padding: "1px 5px" }} /></div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-[13px] font-bold tabular-nums" style={{ color: e.kind === "in" ? LIME : GRAY }}>{fmtSigned(e.amount, e.kind)}</div>
                    {payable ? (
                      <button onClick={() => onPay(e)} disabled={pay.isPending} className="mt-1 rounded-[6px] px-2 py-0.5 text-[9px] font-bold text-[#0a0a0f]" style={{ background: LIME }}>Pagar</button>
                    ) : e.est ? <div className="text-[8.5px] font-semibold" style={{ color: LIME }}>~est.</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  /* ============================ render ============================ */
  return (
    <div className={`overflow-hidden rounded-[20px] border border-[#1c1c24] bg-[#0a0a0f] ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#18181f] px-4 py-4 sm:px-6">
        <div className="flex items-center gap-[13px]">
          <div className="flex size-10 items-center justify-center rounded-[12px]" style={{ background: "radial-gradient(120% 120% at 30% 20%,rgba(205,250,70,.2),rgba(205,250,70,.04))", border: "1px solid rgba(205,250,70,.26)" }}>
            <CalIcon className="size-5" style={{ color: LIME }} strokeWidth={1.9} />
          </div>
          <div>
            <div className="text-[20px] font-extrabold tracking-[-.02em]">Calendario</div>
            <div className="mt-px text-[12px] font-medium text-[#8a8a96]">Qué pagar, cuánto y cuándo · y si te alcanza</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* view toggle (desktop) */}
          <div className="hidden rounded-[10px] border border-[#22222b] bg-[#121219] p-[3px] lg:flex">
            {([["cal", "Calendario"], ["list", "Lista"], ["time", "Timeline"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} className="rounded-[7px] px-3 py-[7px] text-[12px] font-semibold transition-colors" style={view === v ? { background: LIME, color: "#0a0a0f" } : { color: "#9a9aa6" }}>{label}</button>
            ))}
          </div>
          {/* month nav */}
          <div className="flex items-center gap-1 rounded-[10px] border border-[#22222b] bg-[#121219] p-1">
            <button onClick={() => { setMonthOffset((m) => m - 1); setSelectedDay(null); }} className="flex size-[30px] items-center justify-center rounded-[7px] text-[#cfcfd8] hover-elevate"><ChevronLeft className="size-[15px]" strokeWidth={2.2} /></button>
            <div className="min-w-[104px] text-center text-[13px] font-bold">{monthLabel}</div>
            <button onClick={() => { setMonthOffset((m) => m + 1); setSelectedDay(null); }} className="flex size-[30px] items-center justify-center rounded-[7px] text-[#cfcfd8] hover-elevate"><ChevronRight className="size-[15px]" strokeWidth={2.2} /></button>
          </div>
        </div>
      </div>

      {/* ===== DESKTOP ===== */}
      <div className="hidden lg:block">
        {/* summary row */}
        <div className="grid grid-cols-4 gap-[14px] px-6 pb-1 pt-[18px]">
          <div className="rounded-[16px] border border-[#262630] px-[17px] py-[15px]" style={{ background: "linear-gradient(180deg,#17171f,#131319)" }}>
            <div className="flex items-center gap-[7px] text-[11.5px] font-semibold text-[#9a9aa6]"><ArrowDown className="size-[13px]" style={{ color: GRAY }} strokeWidth={2.2} />A pagar este mes</div>
            <div className="mt-[9px] font-mono text-[23px] font-extrabold tabular-nums text-[#f4f4f7]">{formatCLP(sumOut)}</div>
            <div className="mt-[5px] text-[11px] font-medium text-[#6c6c78]">{outs.length} obligaciones</div>
          </div>
          <div className="rounded-[16px] border border-[#262630] px-[17px] py-[15px]" style={{ background: "linear-gradient(180deg,#17171f,#131319)" }}>
            <div className="flex items-center gap-[7px] text-[11.5px] font-semibold text-[#9a9aa6]"><ArrowUp className="size-[13px]" style={{ color: LIME }} strokeWidth={2.2} />Entra este mes</div>
            <div className="mt-[9px] font-mono text-[23px] font-extrabold tabular-nums" style={{ color: LIME }}>{formatCLP(sumIn)}</div>
            <div className="mt-[5px] text-[11px] font-medium text-[#6c6c78]">{ins.length} pagos de clientes</div>
          </div>
          <div className="rounded-[16px] border border-[#262630] px-[17px] py-[15px]" style={{ background: "linear-gradient(180deg,#17171f,#131319)" }}>
            <div className="flex items-center gap-[7px] text-[11.5px] font-semibold text-[#9a9aa6]"><TrendingUp className="size-[13px]" style={{ color: GRAY }} strokeWidth={2} />Neto del mes</div>
            <div className="mt-[9px] font-mono text-[23px] font-extrabold tabular-nums" style={{ color: net >= 0 ? LIME : GRAY }}>{net >= 0 ? "+" : ""}{formatCLP(net)}</div>
            <div className="mt-[5px] text-[11px] font-medium text-[#6c6c78]">entra − sale</div>
          </div>
          <div className="rounded-[16px] border border-[#262630] px-[17px] py-[15px]" style={{ background: "linear-gradient(180deg,#17171f,#131319)" }}>
            <div className="flex items-center gap-[7px] text-[11.5px] font-semibold text-[#9a9aa6]"><Clock className="size-[13px]" style={{ color: GRAY }} strokeWidth={2} />Esta semana</div>
            <div className="mt-[9px] flex items-baseline gap-2"><span className="font-mono text-[16px] font-bold tabular-nums" style={{ color: GRAY }}>{formatCLP(weekOut)}</span><span className="text-[11px] font-medium text-[#6c6c78]">pagás</span></div>
            <div className="mt-0.5 flex items-baseline gap-2"><span className="font-mono text-[16px] font-bold tabular-nums" style={{ color: LIME }}>{formatCLP(weekIn)}</span><span className="text-[11px] font-medium text-[#6c6c78]">entra</span></div>
          </div>
        </div>

        {/* alert */}
        {firstNegDay != null && (
          <div className="mx-6 mt-[14px] flex items-center gap-3 rounded-[13px] px-4 py-[13px]" style={{ background: "rgba(205,250,70,.06)", border: "1px solid rgba(205,250,70,.22)" }}>
            <div className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px]" style={{ background: LIME }}><AlertTriangle className="size-4" style={{ color: "#0a0a0f" }} strokeWidth={2.4} /></div>
            <div className="text-[13px] font-semibold text-[#f4f4f7]">La caja queda en rojo el <b style={{ color: LIME }}>{firstNegDay} {MESES[month].slice(0, 3)}</b> ({formatCLP(bal[firstNegDay] ?? 0)}).{recoverEvent ? <> Recién se recupera cuando entra <b style={{ color: LIME }}>{recoverEvent.name}</b>.</> : ""} Conviene adelantar un cobro o correr un pago.</div>
          </div>
        )}

        {/* filters */}
        <div className="flex flex-wrap items-center gap-[10px] px-6 pb-[18px] pt-[14px]">
          <SegBox>
            <Seg active={filters.ambito === "all"} onClick={() => setFilters((f) => ({ ...f, ambito: "all" }))}>Todos</Seg>
            <Seg active={filters.ambito === "business"} onClick={() => setFilters((f) => ({ ...f, ambito: "business" }))}>{dot(AMB.business.c)}Empresa</Seg>
            <Seg active={filters.ambito === "family"} onClick={() => setFilters((f) => ({ ...f, ambito: "family" }))}>{dot(AMB.family.c)}Familia</Seg>
            <Seg active={filters.ambito === "dentist"} onClick={() => setFilters((f) => ({ ...f, ambito: "dentist" }))}>{dot(AMB.dentist.c)}Consulta Javi</Seg>
          </SegBox>
          <SegBox>
            <Seg active={filters.tipo === "all"} onClick={() => setFilters((f) => ({ ...f, tipo: "all" }))}>Ambos</Seg>
            <Seg active={filters.tipo === "out"} onClick={() => setFilters((f) => ({ ...f, tipo: "out" }))}>Egresos</Seg>
            <Seg active={filters.tipo === "in"} onClick={() => setFilters((f) => ({ ...f, tipo: "in" }))}>Ingresos</Seg>
          </SegBox>
          <SegBox>
            <Seg active={filters.estado === "all"} onClick={() => setFilters((f) => ({ ...f, estado: "all" }))}>Todo estado</Seg>
            <Seg active={filters.estado === "pend"} onClick={() => setFilters((f) => ({ ...f, estado: "pend" }))}>Pendiente</Seg>
            <Seg active={filters.estado === "paid"} onClick={() => setFilters((f) => ({ ...f, estado: "paid" }))}>Pagado</Seg>
            <Seg active={filters.estado === "venc"} onClick={() => setFilters((f) => ({ ...f, estado: "venc" }))}>Vencido</Seg>
          </SegBox>
          <div className="ml-auto flex items-center gap-[14px] text-[11px] font-semibold text-[#8a8a96]">
            <span className="inline-flex items-center gap-[6px]">{dot(LIME)}entra</span>
            <span className="inline-flex items-center gap-[6px]">{dot(GRAY)}sale</span>
            <span className="inline-flex items-center gap-[6px]"><span className="inline-block size-[9px] rounded-[3px] border-[1.5px] border-dashed" style={{ borderColor: LIME }} />~estimado</span>
            <span className="inline-flex items-center gap-[6px]"><AlertTriangle className="size-3" style={{ color: LIME }} strokeWidth={2.4} />vencido</span>
          </div>
        </div>

        {/* body split */}
        <div className="grid grid-cols-[1fr_340px] border-t border-[#18181f]">
          <div className="min-w-0 border-r border-[#18181f] px-[22px] pb-6 pt-[18px]">
            {loading ? (
              <div className="py-16 text-center text-[13px] text-[#6c6c78]">Cargando tu calendario…</div>
            ) : view === "cal" ? (
              <>
                <div className="mb-2 grid grid-cols-7 gap-2">
                  {DOW_SHORT.map((d) => <div key={d} className="text-center text-[10px] font-bold tracking-[.06em] text-[#6c6c78]">{d}</div>)}
                </div>
                {weeks.map((wk, wi) => (
                  <div key={wi} className="mb-2 grid grid-cols-7 gap-2">
                    {wk.map((c, ci) => {
                      if (!c) return <div key={ci} className="min-h-[92px] rounded-[11px]" />;
                      const sel = selectedDay === c.day;
                      return (
                        <button key={ci} onClick={() => setSelectedDay(c.day)} className="min-h-[92px] overflow-hidden rounded-[11px] px-2 pb-[7px] pt-2 text-left transition-colors" style={{ background: sel ? "#15151f" : "#0d0d12", border: `1px solid ${sel ? LIME : c.isToday ? "#3a3a44" : "#1c1c24"}` }}>
                          <div className="flex items-center justify-between">
                            <div className="flex size-[22px] items-center justify-center rounded-[7px] font-mono text-[13px] font-bold" style={{ color: c.isToday ? "#0a0a0f" : GRAY, background: c.isToday ? LIME : "transparent" }}>{c.day}</div>
                            {c.flag && <AlertTriangle className="size-3" style={{ color: LIME }} strokeWidth={2.5} />}
                          </div>
                          <div className="mt-[5px] flex flex-col gap-[3px]">
                            {c.vis.map((e) => <EventChip key={e.id} e={e} />)}
                            {c.more > 0 && <div className="pl-0.5 text-[10px] font-semibold text-[#7a7a86]">+{c.more} más</div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {balStrip}
              </>
            ) : (
              listView
            )}
          </div>
          <div className="min-w-0 bg-[#0b0b10] px-5 pb-6 pt-[18px]">{dayPanel}</div>
        </div>
      </div>

      {/* ===== MOBILE (M1: agenda + mini-mes) ===== */}
      <div className="lg:hidden">
        <div className="px-4 pt-3">
          <div className="flex gap-[7px]">
            <div className="flex-1 rounded-[11px] border border-[#20202a] bg-[#101016] px-[10px] py-[9px]"><div className="text-[9px] font-semibold text-[#8a8a96]">A pagar</div><div className="mt-0.5 font-mono text-[14px] font-bold" style={{ color: GRAY }}>{fmtChip(sumOut)}</div></div>
            <div className="flex-1 rounded-[11px] border border-[#20202a] bg-[#101016] px-[10px] py-[9px]"><div className="text-[9px] font-semibold text-[#8a8a96]">Entra</div><div className="mt-0.5 font-mono text-[14px] font-bold" style={{ color: LIME }}>{fmtChip(sumIn)}</div></div>
          </div>
          {firstNegDay != null && (
            <div className="mt-3 flex items-center gap-[10px] rounded-[12px] px-3 py-[11px]" style={{ background: "rgba(205,250,70,.06)", border: "1px solid rgba(205,250,70,.22)" }}>
              <AlertTriangle className="size-4 shrink-0" style={{ color: LIME }} strokeWidth={2.2} />
              <div className="text-[12px] font-semibold text-[#f4f4f7]">Caja en rojo el <b style={{ color: LIME }}>{firstNegDay} {MESES[month].slice(0, 3)}</b> ({fmtShort(bal[firstNegDay] ?? 0)}).</div>
            </div>
          )}
          <div className="mt-3">{miniMonth}</div>
        </div>
        <div className="px-4 pb-2">{loading ? <div className="py-10 text-center text-[12.5px] text-[#6c6c78]">Cargando…</div> : mobileAgenda}</div>
      </div>
    </div>
  );
}
