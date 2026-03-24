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
  Sparkles,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
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
} from "@/components/ui/sidebar";

const mainNav = [
  { title: "Resumen", url: "/", icon: LayoutDashboard },
  { title: "Flujo de Caja", url: "/cash-flow", icon: ArrowUpDown },
  { title: "Estado de Resultados", url: "/pnl", icon: FileText },
  { title: "Ingresos Clientes", url: "/client-payments", icon: BriefcaseBusiness },
  { title: "Presupuesto", url: "/budget", icon: Target },
  { title: "Cierre Mensual", url: "/monthly-close", icon: ClipboardList },
  { title: "Panel de Tarjetas", url: "/credit-cards", icon: CreditCard },
  { title: "Importar Datos", url: "/import", icon: Upload },
];

const settingsNav = [
  { title: "Branding", url: "/settings", icon: Settings },
  { title: "Categorías", url: "/categories", icon: Tags },
  { title: "Cuentas", url: "/accounts", icon: Landmark },
  { title: "Items", url: "/items", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncLogo = () => setLogoDataUrl(window.localStorage.getItem("octopus_app_logo"));
    syncLogo();
    window.addEventListener("octopus-logo-updated", syncLogo);
    return () => window.removeEventListener("octopus-logo-updated", syncLogo);
  }, [location]);

  return (
    <Sidebar
      data-testid="sidebar-nav"
      className="border-r border-[#bb9eff]/5 bg-[#141123]/90 text-[#ece5fc] backdrop-blur-2xl shadow-[10px_0_30px_rgba(0,0,0,0.5)]"
    >
      <SidebarHeader className="px-6 pb-8 pt-8">
        <div className="flex items-center gap-3 px-2">
          {logoDataUrl ? (
            <img
              src={logoDataUrl}
              alt="Octopus Finance Logo"
              className="size-10 rounded-full object-cover ring-2 ring-[#bb9eff]/30 electric-glow"
            />
          ) : (
            <div className="electric-glow flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-[#bb9eff] to-[#a691f9]">
              <Sparkles className="size-5 text-[#2c006d]" strokeWidth={2.75} />
            </div>
          )}
          <div>
            <h1 className="text-xl font-black tracking-tighter text-[#bb9eff] drop-shadow-[0_0_10px_rgba(187,158,255,0.6)]">
              Octopus Finance
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#ad89ff]/60">
              Dashboard
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-4">
        <SidebarGroup>
          <SidebarGroupLabel className="sr-only">
            Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-2">
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.replace("/", "") || "home"}`}
                    className="mx-0 h-12 rounded-full px-5 text-[#c9baff]/40 transition-all duration-300 hover:bg-[#27233a] hover:text-[#c9baff] data-[active=true]:bg-gradient-to-r data-[active=true]:from-[#bb9eff] data-[active=true]:to-[#a691f9] data-[active=true]:text-[#0f0c1c] data-[active=true]:shadow-[0_0_20px_rgba(187,158,255,0.5)] data-[active=true]:hover:text-[#0f0c1c]"
                  >
                    <Link href={item.url}>
                      <item.icon className="size-4 shrink-0" />
                      <span className="font-headline text-sm font-bold uppercase tracking-wide">
                        {item.title}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-6">
          <SidebarGroupLabel className="sr-only">
            Configuración
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-2">
              {settingsNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.replace("/", "")}`}
                    className="mx-0 h-12 rounded-full px-5 text-[#c9baff]/40 transition-all duration-300 hover:bg-[#27233a] hover:text-[#c9baff] data-[active=true]:bg-gradient-to-r data-[active=true]:from-[#bb9eff] data-[active=true]:to-[#a691f9] data-[active=true]:text-[#0f0c1c] data-[active=true]:shadow-[0_0_20px_rgba(187,158,255,0.5)] data-[active=true]:hover:text-[#0f0c1c]"
                  >
                    <Link href={item.url}>
                      <item.icon className="size-4 shrink-0" />
                      <span className="font-headline text-sm font-bold uppercase tracking-wide">
                        {item.title}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

    </Sidebar>
  );
}
