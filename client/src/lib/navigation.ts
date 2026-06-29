import type { LucideIcon } from "lucide-react";
import {
  ArrowUpDown,
  BriefcaseBusiness,
  CalendarClock,
  ClipboardList,
  CreditCard,
  Database,
  FileText,
  Inbox,
  Landmark,
  LayoutDashboard,
  Scale,
  Settings,
  Sparkles,
  Tags,
  Target,
  Wallet,
} from "lucide-react";

export type NavGroupLabel =
  | "Panorama"
  | "Operación mensual"
  | "Planificación"
  | "Ajustes";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: string;
};

export type NavGroup = {
  label: NavGroupLabel;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Panorama",
    items: [
      { title: "Resumen", url: "/", icon: LayoutDashboard },
      { title: "Tu asesor", url: "/advisor", icon: Sparkles },
      { title: "Flujo de Caja", url: "/cash-flow", icon: ArrowUpDown },
      { title: "Estado de Resultados", url: "/pnl", icon: FileText },
    ],
  },
  {
    label: "Operación mensual",
    items: [
      { title: "Movimientos", url: "/transactions", icon: Wallet },
      { title: "Revisión de cartola", url: "/movements", icon: Inbox },
      { title: "Conciliación", url: "/reconciliation", icon: Scale },
      { title: "Automatización", url: "/automation", icon: CalendarClock },
      { title: "Panel de Tarjetas", url: "/credit-cards", icon: CreditCard },
      { title: "Cierre Mensual", url: "/monthly-close", icon: ClipboardList },
    ],
  },
  {
    label: "Planificación",
    items: [
      { title: "Presupuesto", url: "/budget", icon: Target },
      { title: "Ingresos Clientes", url: "/client-payments", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "Ajustes",
    items: [
      { title: "Categorías", url: "/categories", icon: Tags },
      { title: "Cuentas", url: "/accounts", icon: Landmark },
      { title: "Items", url: "/items", icon: Settings },
      { title: "Salud de Datos", url: "/data-health", icon: Database },
      { title: "Branding", url: "/settings", icon: Settings },
    ],
  },
];
