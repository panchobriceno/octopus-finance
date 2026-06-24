import { useMemo } from "react";
import { auditFinanceData, summarizeIssuesByArea } from "@/domain/finance-audit";
import {
  useAccounts,
  useBudgets,
  useCategories,
  useClientPayments,
  useClients,
  useCreditCardSettings,
  useItems,
  useOpeningBalances,
  useTransactions,
} from "@/lib/hooks";

/**
 * Hook compartido sobre el motor de auditoría que ya existe.
 *
 * Es exactamente el useMemo(auditFinanceData(...)) que hoy vive inline en
 * data-health.tsx, extraído para que el Resumen (y luego Cierre) lo reutilicen.
 * No agrega lógica de negocio: solo la mueve a un lugar reutilizable.
 *
 * Refactor sugerido: reemplazar el useMemo inline de data-health.tsx por una
 * llamada a este hook para tener una sola fuente.
 */
export function useFinanceAudit() {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: items = [] } = useItems();
  const { data: budgets = [] } = useBudgets();
  const { data: clientPayments = [] } = useClientPayments();
  const { data: clients = [] } = useClients();
  const { data: accounts = [] } = useAccounts();
  const { data: creditCardSettings = [] } = useCreditCardSettings();
  const { data: openingBalances = [] } = useOpeningBalances();

  const audit = useMemo(
    () =>
      auditFinanceData({
        transactions,
        categories,
        items,
        budgets,
        clientPayments,
        clients,
        accounts,
        creditCardSettings,
        openingBalances,
      }),
    [
      transactions,
      categories,
      items,
      budgets,
      clientPayments,
      clients,
      accounts,
      creditCardSettings,
      openingBalances,
    ],
  );

  const byArea = useMemo(() => summarizeIssuesByArea(audit.issues), [audit.issues]);

  return { audit, issues: audit.issues, byArea };
}
