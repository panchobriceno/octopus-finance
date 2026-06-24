import { useEffect } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import NotFound from "@/pages/not-found";
import OverviewPage from "@/pages/overview";
import CashFlowPage from "@/pages/cash-flow";
import PnLPage from "@/pages/pnl";
import ImportDataPage from "@/pages/import-data";
import CategoriesPage from "@/pages/categories";
import ItemsManagerPage from "@/pages/items-manager";
import AccountsPage from "@/pages/accounts";
import BudgetPage from "@/pages/budget";
import ClientPaymentsPage from "@/pages/client-payments";
import SettingsPage from "@/pages/settings";
import MonthlyClosePage from "@/pages/monthly-close";
import CreditCardsPanelPage from "@/pages/credit-cards-panel";
import MonthlyAutomationPage from "@/pages/monthly-automation";
import BankMovementsPage from "@/pages/bank-movements";
import DataHealthPage from "@/pages/data-health";
import ReconciliationPage from "@/pages/reconciliation";
import { getCurrentMonthKey } from "@/lib/finance";
import { autoCarryForwardOpeningBalance } from "@/lib/monthly-balances";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={OverviewPage} />
      <Route path="/cash-flow" component={CashFlowPage} />
      <Route path="/pnl" component={PnLPage} />
      <Route path="/import" component={ImportDataPage} />
      <Route path="/client-payments" component={ClientPaymentsPage} />
      <Route path="/budget" component={BudgetPage} />
      <Route path="/monthly-close" component={MonthlyClosePage} />
      <Route path="/automation" component={MonthlyAutomationPage} />
      <Route path="/movements" component={BankMovementsPage} />
      <Route path="/reconciliation" component={ReconciliationPage} />
      <Route path="/data-health" component={DataHealthPage} />
      <Route path="/credit-cards" component={CreditCardsPanelPage} />
      <Route path="/categories" component={CategoriesPage} />
      <Route path="/accounts" component={AccountsPage} />
      <Route path="/items" component={ItemsManagerPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const sidebarStyle = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3rem",
};

function App() {
  useEffect(() => {
    void autoCarryForwardOpeningBalance(getCurrentMonthKey());
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router hook={useHashLocation}>
          <CommandPalette />
          <SidebarProvider style={sidebarStyle as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex min-h-0 flex-1 flex-col min-w-0">
                <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0b0914]/95 px-3 text-[#f1e9fc] backdrop-blur-xl md:hidden">
                  <SidebarTrigger
                    aria-label="Abrir navegación"
                    className="size-9 rounded-lg border border-white/10 bg-[#171225] text-[#f1e9fc] hover:bg-[#211a31]"
                  />
                  <span className="text-sm font-extrabold tracking-tight">Octopus Finance</span>
                </div>
                <main className="flex-1 overflow-hidden">
                  <AppRouter />
                </main>
              </div>
            </div>
          </SidebarProvider>
        </Router>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
