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
import { NAV_GROUPS } from "@/lib/navigation";

// Clases idénticas a las actuales — no cambia el look del item activo.
const ITEM_CLASS =
  "mx-0 h-11 rounded-full px-5 text-[#c9baff]/40 transition-all duration-300 " +
  "hover:bg-[#27233a] hover:text-[#c9baff] " +
  "data-[active=true]:bg-gradient-to-r data-[active=true]:from-[#bb9eff] " +
  "data-[active=true]:to-[#a691f9] data-[active=true]:text-[#0f0c1c] " +
  "data-[active=true]:shadow-[0_0_20px_rgba(187,158,255,0.5)] " +
  "data-[active=true]:hover:text-[#0f0c1c]";

export function AppSidebar() {
  const [location] = useLocation();
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const logoSrc = logoDataUrl ?? "/octopus-logo.svg";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncLogo = () =>
      setLogoDataUrl(window.localStorage.getItem("octopus_app_logo"));
    syncLogo();
    window.addEventListener("octopus-logo-updated", syncLogo);
    return () => window.removeEventListener("octopus-logo-updated", syncLogo);
  }, [location]);

  return (
    <Sidebar
      data-testid="sidebar-nav"
      className="border-r border-[#bb9eff]/5 bg-[#141123]/90 text-[#ece5fc] backdrop-blur-2xl shadow-[10px_0_30px_rgba(0,0,0,0.5)]"
    >
      <SidebarHeader className="px-6 pb-6 pt-8">
        <div className="flex items-center gap-3 px-2">
          <img
            src={logoSrc}
            alt="Octopus Finance Logo"
            className="size-10 rounded-2xl object-cover ring-2 ring-[#bb9eff]/30 electric-glow"
          />
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
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="mt-2">
            <SidebarGroupLabel className="px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#ad89ff]/50">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      data-testid={`nav-${item.url.replace("/", "") || "home"}`}
                      className={ITEM_CLASS}
                    >
                      <Link href={item.url}>
                        <item.icon className="size-4 shrink-0" />
                        <span className="font-headline text-sm font-bold uppercase tracking-wide">
                          {item.title}
                        </span>
                        {item.badge ? (
                          <span className="ml-auto rounded-md bg-[#9ef0cf]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#9ef0cf]">
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
