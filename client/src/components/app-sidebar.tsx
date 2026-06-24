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

const ITEM_CLASS =
  "mx-0 h-10 rounded-lg px-3 text-[#9a9aa6]/62 transition-all duration-200 " +
  "hover:bg-[#22222b] hover:text-[#f4f4f7] " +
  "data-[active=true]:border data-[active=true]:border-[#cdfa46]/24 " +
  "data-[active=true]:bg-[#2a213d] data-[active=true]:text-[#d8c7ff] " +
  "data-[active=true]:shadow-[inset_0_0_0_1px_rgba(187,158,255,0.1)]";

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
      className="border-r border-white/10 bg-[#0a0a0f] text-[#f4f4f7]"
    >
      <SidebarHeader className="px-5 pb-6 pt-7">
        <div className="flex items-center gap-3 px-1">
          <img
            src={logoSrc}
            alt="Octopus Finance Logo"
            className="size-9 rounded-xl object-cover ring-1 ring-white/10"
          />
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-[#f4f4f7]">
              Octopus Finance
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9a9aa6]">
              Dashboard
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="mt-1">
            <SidebarGroupLabel className="px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6c6c78]">
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
                        <span className="truncate text-sm font-semibold">
                          {item.title}
                        </span>
                        {item.badge ? (
                          <span className="ml-auto rounded-md bg-[#cdfa46]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#cdfa46]">
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
