import { LayoutDashboard, ArrowUpDown, FileText, Upload, Settings, Tags, Target, BriefcaseBusiness } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";

const mainNav = [
  { title: "Resumen", url: "/", icon: LayoutDashboard },
  { title: "Flujo de Caja", url: "/cash-flow", icon: ArrowUpDown },
  { title: "Estado de Resultados", url: "/pnl", icon: FileText },
  { title: "Ingresos Clientes", url: "/client-payments", icon: BriefcaseBusiness },
  { title: "Importar Datos", url: "/import", icon: Upload },
  { title: "Presupuesto", url: "/budget", icon: Target },
];

const settingsNav = [
  { title: "Categorías", url: "/categories", icon: Tags },
  { title: "Items", url: "/items", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar data-testid="sidebar-nav">
      <SidebarHeader className="px-4 py-5">
        <div className="flex items-center gap-3">
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            fill="none"
            aria-label="Octopus Finance Logo"
          >
            <rect width="32" height="32" rx="8" fill="hsl(160, 84%, 39%)" />
            <path
              d="M8 22V14a8 8 0 0116 0v8"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              d="M12 22V17M16 22V15M20 22V17"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <div>
            <h1 className="text-sm font-semibold text-sidebar-foreground tracking-tight">
              Octopus Finance
            </h1>
            <p className="text-xs text-sidebar-foreground/60">
              Dashboard
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider">
            Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.replace("/", "") || "home"}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider">
            Configuración
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.replace("/", "")}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 py-3">
        <p className="text-xs text-sidebar-foreground/40">
          Octopus Media &copy; 2026
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
