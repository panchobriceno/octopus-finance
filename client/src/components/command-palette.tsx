import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard,
  ArrowUpDown,
  FileText,
  Upload,
  Settings,
  Tags,
  Target,
  BriefcaseBusiness,
  ClipboardList,
  CreditCard,
  Landmark,
  CalendarClock,
  Inbox,
  Database,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type PaletteItem = { title: string; url: string; icon: LucideIcon; group: string };

// Mismas rutas que el sidebar (App.tsx). Mantener en sync si cambian.
const ITEMS: PaletteItem[] = [
  { title: "Resumen", url: "/", icon: LayoutDashboard, group: "Panorama" },
  { title: "Flujo de Caja", url: "/cash-flow", icon: ArrowUpDown, group: "Panorama" },
  { title: "Estado de Resultados", url: "/pnl", icon: FileText, group: "Panorama" },
  { title: "Movimientos", url: "/movements", icon: Inbox, group: "Operación mensual" },
  { title: "Automatización", url: "/automation", icon: CalendarClock, group: "Operación mensual" },
  { title: "Panel de Tarjetas", url: "/credit-cards", icon: CreditCard, group: "Operación mensual" },
  { title: "Cierre Mensual", url: "/monthly-close", icon: ClipboardList, group: "Operación mensual" },
  { title: "Importar Datos", url: "/import", icon: Upload, group: "Operación mensual" },
  { title: "Presupuesto", url: "/budget", icon: Target, group: "Planificación" },
  { title: "Ingresos Clientes", url: "/client-payments", icon: BriefcaseBusiness, group: "Planificación" },
  { title: "Categorías", url: "/categories", icon: Tags, group: "Ajustes" },
  { title: "Cuentas", url: "/accounts", icon: Landmark, group: "Ajustes" },
  { title: "Items", url: "/items", icon: Settings, group: "Ajustes" },
  { title: "Salud de Datos", url: "/data-health", icon: Database, group: "Ajustes" },
  { title: "Branding", url: "/settings", icon: Settings, group: "Ajustes" },
];

const GROUPS = ["Panorama", "Operación mensual", "Planificación", "Ajustes"] as const;

/**
 * Command palette global (Cmd/Ctrl+K) — Fase 2.3.
 *
 * Salta a cualquier pantalla. Requiere el modificador meta/ctrl, así que no se
 * dispara escribiendo texto normal en inputs (guard que pidió codex). El
 * MonthSwitcher global queda diferido: cada página tiene su propio estado de mes
 * y unificarlo es un refactor de estado de negocio, no presentación.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      // Ctrl+K es un atajo nativo de edición de texto en macOS ("borrar hasta fin
      // de línea"). No lo secuestramos cuando el foco está en un campo editable.
      // Cmd+K no tiene ese conflicto y sigue funcionando en todos lados.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true;
      if (editable && event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setOpen((prev) => !prev);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar pantalla… (Cmd+K)" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        {GROUPS.map((group) => (
          <CommandGroup key={group} heading={group}>
            {ITEMS.filter((item) => item.group === group).map((item) => (
              <CommandItem
                key={item.url}
                value={item.title}
                onSelect={() => {
                  setOpen(false);
                  navigate(item.url);
                }}
              >
                <item.icon className="mr-2 size-4" />
                {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
