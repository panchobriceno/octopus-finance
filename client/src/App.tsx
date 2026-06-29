import { useEffect, useRef, useState } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ImportWizardDialog } from "@/components/finance/import-wizard-dialog";
import { QuickExpenseCapture } from "@/components/finance/quick-expense-capture";
import NotFound from "@/pages/not-found";
import OverviewPage from "@/pages/overview";
import AdvisorPage from "@/pages/advisor";
import CashFlowPage from "@/pages/cash-flow";
import PnLPage from "@/pages/pnl";
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
import TransactionsPage from "@/pages/transactions";
import { getCurrentMonthKey } from "@/lib/finance";
import { IMPORT_WIZARD_OPEN_EVENT, IMPORT_WIZARD_CLOSE_EVENT, openImportWizard } from "@/lib/import-wizard";
import { autoCarryForwardOpeningBalance } from "@/lib/monthly-balances";
import { useGenerateCommitmentInstances, useGenerateClientPaymentInstances } from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";

// Wrappers estables: estas páginas ahora aceptan props opcionales (modo wizard),
// lo que choca con el tipo de `component` de wouter. Un wrapper de identidad fija
// las usa sin props en su ruta, sin remontar.
function ImportRoute() {
  const [, navigate] = useLocation();

  useEffect(() => {
    navigate("/movements");
    openImportWizard();
  }, [navigate]);

  return null;
}
function MovementsRoute() {
  return <BankMovementsPage />;
}

function GlobalImportWizard() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openWizard = () => setOpen(true);
    const closeWizard = () => setOpen(false);
    window.addEventListener(IMPORT_WIZARD_OPEN_EVENT, openWizard);
    window.addEventListener(IMPORT_WIZARD_CLOSE_EVENT, closeWizard);
    return () => {
      window.removeEventListener(IMPORT_WIZARD_OPEN_EVENT, openWizard);
      window.removeEventListener(IMPORT_WIZARD_CLOSE_EVENT, closeWizard);
    };
  }, []);

  return <ImportWizardDialog open={open} onOpenChange={setOpen} />;
}

// Genera solos los compromisos recurrentes del mes al abrir la app, sin que el
// usuario apriete "Generar mes". La generación es idempotente y los documentos
// usan ID determinístico (plantilla+mes), así que repetir o correr en paralelo
// (otra pestaña, otro dispositivo) no duplica. El flag de localStorage es solo un
// throttle para no re-intentar ni mostrar el aviso en cada carga; el useRef evita
// re-disparos por re-render dentro de la misma carga.
function AutoGenerateCommitments() {
  const generate = useGenerateCommitmentInstances();
  const { toast } = useToast();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const monthKey = getCurrentMonthKey();
    const flagKey = `octopus:autogen:${monthKey}`;
    if (localStorage.getItem(flagKey)) return;

    generate.mutate(monthKey, {
      onSuccess: (result) => {
        // Marcamos el mes como "ya corrido" solo si ya existen plantillas (haya
        // creado algo o no). Si todavía no hay ninguna, no seteamos el flag para
        // que reintente cuando el usuario cree la primera plantilla del mes.
        if (result.templatesScanned > 0) {
          localStorage.setItem(flagKey, new Date().toISOString());
        }
        if (result.created > 0) {
          toast({
            title: "Compromisos del mes generados",
            description: `${result.created} creados automáticamente.`,
          });
        }
      },
      onError: () => {
        // No marcamos el flag: reintenta en la próxima apertura. Avisamos para no
        // dejar al usuario creyendo que el mes quedó generado cuando no fue así.
        toast({
          title: "No se pudieron generar los compromisos",
          description: "Lo reintento la próxima vez que abras la app.",
          variant: "destructive",
        });
      },
    });
  }, [generate, toast]);

  return null;
}

// Genera solos los ingresos del mes para cada cliente recurrente activo (igual que
// los compromisos de gasto): ID determinístico + skip si ya existe, así nunca pisa
// una fila ya facturada/pagada. localStorage throttlea por mes; useRef evita doble
// disparo en la misma carga.
function AutoGenerateClientPayments() {
  const generate = useGenerateClientPaymentInstances();
  const { toast } = useToast();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const monthKey = getCurrentMonthKey();
    const flagKey = `octopus:autogen-clients:${monthKey}`;
    if (localStorage.getItem(flagKey)) return;

    generate.mutate(monthKey, {
      onSuccess: (result) => {
        if (result.scanned > 0) {
          localStorage.setItem(flagKey, new Date().toISOString());
        }
        if (result.created > 0) {
          toast({
            title: "Ingresos del mes generados",
            description: `${result.created} clientes listos para facturar.`,
          });
        }
      },
      onError: () => {
        toast({
          title: "No se pudieron generar los ingresos del mes",
          description: "Lo reintento la próxima vez que abras la app.",
          variant: "destructive",
        });
      },
    });
  }, [generate, toast]);

  return null;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={OverviewPage} />
      <Route path="/advisor" component={AdvisorPage} />
      <Route path="/cash-flow" component={CashFlowPage} />
      <Route path="/pnl" component={PnLPage} />
      <Route path="/import" component={ImportRoute} />
      <Route path="/client-payments" component={ClientPaymentsPage} />
      <Route path="/budget" component={BudgetPage} />
      <Route path="/monthly-close" component={MonthlyClosePage} />
      <Route path="/automation" component={MonthlyAutomationPage} />
      <Route path="/transactions" component={TransactionsPage} />
      <Route path="/movements" component={MovementsRoute} />
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
          <GlobalImportWizard />
          <AutoGenerateCommitments />
          <AutoGenerateClientPayments />
          <QuickExpenseCapture />
          <SidebarProvider style={sidebarStyle as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex min-h-0 flex-1 flex-col min-w-0">
                <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-[#0a0a0f]/95 px-3 text-[#f4f4f7] backdrop-blur-xl md:hidden">
                  <SidebarTrigger
                    aria-label="Abrir navegación"
                    className="size-9 rounded-lg border border-white/10 bg-[#15151c] text-[#f4f4f7] hover:bg-[#22222b]"
                  />
                  <span className="text-sm font-extrabold tracking-tight">Octopus Finance</span>
                </div>
                <main className="flex-1 overflow-hidden">
                  <AppRouter />
                </main>
                <MobileTabBar />
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
