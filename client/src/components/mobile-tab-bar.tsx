import { useLocation } from "wouter";
import { Home, ArrowLeftRight, Camera, PieChart, Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * Barra de navegación inferior para móvil (P0 del handoff).
 * Inicio · Movimientos · Capturar (centro, lima) · Presupuesto · Más.
 * Se renderiza como item de layout (no flotante) y solo en < md, así que
 * no tapa contenido y desaparece en desktop, donde manda el sidebar.
 * "Capturar" dispara el mismo evento global que el FAB de captura rápida.
 * "Más" abre el sidebar completo como sheet.
 */
export function MobileTabBar() {
  const [location, setLocation] = useLocation();
  const { setOpenMobile } = useSidebar();

  const isActive = (path: string) =>
    path === "/" ? location === "/" : location.startsWith(path);

  const openCapture = () =>
    window.dispatchEvent(new Event("octopus-quick-expense-open"));

  const navItem = (path: string, label: string, Icon: typeof Home) => {
    const active = isActive(path);
    return (
      <button
        type="button"
        onClick={() => setLocation(path)}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors",
          active ? "text-[#cdfa46]" : "text-[#6c6c78] hover:text-[#cfcfd8]",
        )}
        aria-current={active ? "page" : undefined}
        data-testid={`tab-${label.toLowerCase()}`}
      >
        <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
        <span className="text-[10px] font-semibold">{label}</span>
      </button>
    );
  };

  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-[#18181f] bg-[#08080c]/95 px-1 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {navItem("/", "Inicio", Home)}
      {navItem("/transactions", "Movim.", ArrowLeftRight)}

      {/* Capturar — centro elevado */}
      <button
        type="button"
        onClick={openCapture}
        className="flex flex-1 flex-col items-center justify-center"
        aria-label="Captura rápida"
        data-testid="tab-capturar"
      >
        <span className="-mt-6 flex size-[52px] items-center justify-center rounded-2xl bg-[#cdfa46] text-[#0a0a0f] shadow-[0_8px_22px_rgba(205,250,70,0.35)]">
          <Camera className="size-6" strokeWidth={2.2} />
        </span>
        <span className="mt-0.5 text-[10px] font-semibold text-[#cdfa46]">Capturar</span>
      </button>

      {navItem("/budget", "Presup.", PieChart)}

      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[#6c6c78] transition-colors hover:text-[#cfcfd8]"
        aria-label="Más secciones"
        data-testid="tab-mas"
      >
        <Menu className="size-[22px]" strokeWidth={1.8} />
        <span className="text-[10px] font-semibold">Más</span>
      </button>
    </nav>
  );
}
