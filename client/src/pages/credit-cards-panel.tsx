import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CreditCard, Landmark, Pencil, Trash2, Upload } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAccounts,
  useBulkDeleteTransactions,
  useCategories,
  useCreateCreditCardSetting,
  useCreditCardSettings,
  useDeleteTransaction,
  useTransactions,
  useUpdateCreditCardSetting,
  useUpdateTransaction,
} from "@/lib/hooks";
import { buildCreditCardInstallmentProjectionTransactions, getMonthKeyFromDate, isExecutedTransaction, normalizeTransaction } from "@/lib/finance";
import { getCreditCards } from "@/lib/credit-cards";
import { openImportWizard } from "@/lib/import-wizard";
import { cn, formatCLP } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type CardSummary = {
  cardName: string;
  debt: number;
  monthlyPurchases: number;
  monthlyPayments: number;
  installmentsDueThisMonth: number;
  installmentsDueThisMonthCount: number;
  futureInstallments: number;
  futureInstallmentsCount: number;
};

type InstallmentProjectionRow = ReturnType<typeof normalizeTransaction> & {
  sourceTransaction: ReturnType<typeof normalizeTransaction> | null;
};

type ImportBatchSummary = {
  id: string;
  label: string;
  importedAt: string;
  cardName: string;
  rows: number;
  totalAmount: number;
};

function accountDisplayName(account: { name: string; bank: string }) {
  return `${account.name} — ${account.bank}`;
}

function getPeriodLabel(month: number, year: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function getWorkspaceLabel(workspace: string | null | undefined) {
  if (workspace === "business") return "Empresa";
  if (workspace === "family") return "Familia";
  if (workspace === "dentist") return "Consulta Dentista";
  if (workspace === "shared") return "Compartido";
  return "Empresa";
}

function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function areStringRecordsEqual(left: Record<string, string>, right: Record<string, string>) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

export default function CreditCardsPanelPage() {
  const currentPeriod = useMemo(() => {
    const current = new Date();
    return {
      month: current.getMonth() + 1,
      year: current.getFullYear(),
    };
  }, []);
  const [selectedMonth, setSelectedMonth] = useState(currentPeriod.month);
  const [selectedYear, setSelectedYear] = useState(currentPeriod.year);
  const [savedCards, setSavedCards] = useState<string[]>([]);
  const [selectedCard, setSelectedCard] = useState<string>("all");
  const [editingTransaction, setEditingTransaction] = useState<ReturnType<typeof normalizeTransaction> | null>(null);
  const [deleteTransaction, setDeleteTransaction] = useState<ReturnType<typeof normalizeTransaction> | null>(null);
  const [selectedFutureIds, setSelectedFutureIds] = useState<Set<string>>(new Set());
  const [batchToDelete, setBatchToDelete] = useState<ImportBatchSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editInstallments, setEditInstallments] = useState("1");
  const [paymentAccountDrafts, setPaymentAccountDrafts] = useState<Record<string, string>>({});

  const { data: transactions = [], isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: creditCardSettings = [] } = useCreditCardSettings();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();
  const bulkDeleteMutation = useBulkDeleteTransactions();
  const createCreditCardSettingMutation = useCreateCreditCardSetting();
  const updateCreditCardSettingMutation = useUpdateCreditCardSetting();
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncCards = () => {
      const nextCards = getCreditCards();
      setSavedCards((current) => areStringArraysEqual(current, nextCards) ? current : nextCards);
    };
    syncCards();
    window.addEventListener("octopus-credit-cards-updated", syncCards);
    return () => window.removeEventListener("octopus-credit-cards-updated", syncCards);
  }, []);

  const selectedMonthKey = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;

  const bankAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        const isBankType = account.type === "checking" || account.type === "savings";
        const isActive = (account as { isActive?: boolean }).isActive ?? true;
        return isBankType && isActive;
      }),
    [accounts],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );

  const creditCardTransactions = useMemo(
    () =>
      transactions
        .map((transaction) => normalizeTransaction(transaction))
        .filter((transaction) =>
          transaction.creditCardName &&
          (
            (transaction.movementType === "expense" && transaction.paymentMethod === "credit_card") ||
            transaction.movementType === "credit_card_payment"
          ),
        ),
    [transactions],
  );

  const projectedInstallments = useMemo(
    () =>
      buildCreditCardInstallmentProjectionTransactions(transactions)
        .map((transaction) => normalizeTransaction(transaction))
        .filter((transaction) => transaction.creditCardName),
    [transactions],
  );

  const normalizedTransactions = useMemo(
    () => transactions.map((transaction) => normalizeTransaction(transaction)),
    [transactions],
  );

  const cardNames = useMemo(() => {
    const fromTransactions = creditCardTransactions
      .map((transaction) => transaction.creditCardName)
      .filter((value): value is string => Boolean(value));

    return Array.from(new Set([...savedCards, ...fromTransactions])).sort((left, right) =>
      left.localeCompare(right, "es"),
    );
  }, [creditCardTransactions, savedCards]);

  useEffect(() => {
    const nextDrafts = Object.fromEntries(
      cardNames.map((cardName) => {
        const matchedSetting = creditCardSettings.find((setting) => setting.cardName === cardName);
        return [cardName, matchedSetting?.defaultPaymentAccountId ?? "none"];
      }),
    );
    setPaymentAccountDrafts((current) => areStringRecordsEqual(current, nextDrafts) ? current : nextDrafts);
  }, [cardNames, creditCardSettings]);

  useEffect(() => {
    if (selectedCard !== "all" && !cardNames.includes(selectedCard)) {
      setSelectedCard("all");
    }
  }, [cardNames, selectedCard]);

  useEffect(() => {
    setSelectedFutureIds(new Set());
  }, [selectedCard, selectedMonthKey]);

  const years = useMemo(() => {
    const set = new Set<number>([currentPeriod.year]);

    for (const transaction of creditCardTransactions) {
      set.add(parseInt(transaction.date.slice(0, 4), 10));
    }

    for (const transaction of projectedInstallments) {
      set.add(parseInt(transaction.date.slice(0, 4), 10));
    }

    return Array.from(set).sort((left, right) => right - left);
  }, [creditCardTransactions, currentPeriod.year, projectedInstallments]);

  const filteredRealTransactions = useMemo(
    () =>
      creditCardTransactions.filter((transaction) =>
        selectedCard === "all" ? true : transaction.creditCardName === selectedCard,
      ),
    [creditCardTransactions, selectedCard],
  );

  const filteredProjectedInstallments = useMemo(
    () =>
      projectedInstallments.filter((transaction) =>
        selectedCard === "all" ? true : transaction.creditCardName === selectedCard,
      ),
    [projectedInstallments, selectedCard],
  );

  const summaries = useMemo<CardSummary[]>(() => {
    return cardNames.map((cardName) => {
      const cardTransactions = creditCardTransactions.filter((transaction) => transaction.creditCardName === cardName);
      const cardInstallments = projectedInstallments.filter((transaction) => transaction.creditCardName === cardName);

      const debt = cardTransactions.reduce((sum, transaction) => {
        if (!isExecutedTransaction(transaction)) return sum;

        if (transaction.movementType === "expense" && transaction.paymentMethod === "credit_card") {
          return sum + transaction.amount;
        }

        if (transaction.movementType === "credit_card_payment") {
          return sum - transaction.amount;
        }

        return sum;
      }, 0);

      const monthlyPurchases = cardTransactions.reduce((sum, transaction) => {
        if (
          isExecutedTransaction(transaction) &&
          transaction.movementType === "expense" &&
          transaction.paymentMethod === "credit_card" &&
          getMonthKeyFromDate(transaction.date) === selectedMonthKey
        ) {
          return sum + transaction.amount;
        }
        return sum;
      }, 0);

      const monthlyPayments = cardTransactions.reduce((sum, transaction) => {
        if (
          isExecutedTransaction(transaction) &&
          transaction.movementType === "credit_card_payment" &&
          getMonthKeyFromDate(transaction.date) === selectedMonthKey
        ) {
          return sum + transaction.amount;
        }
        return sum;
      }, 0);

      const futureInstallments = cardInstallments.reduce((sum, transaction) => {
        if (transaction.date >= `${selectedMonthKey}-01`) {
          return sum + transaction.amount;
        }
        return sum;
      }, 0);

      const futureInstallmentsCount = cardInstallments.filter((transaction) => transaction.date >= `${selectedMonthKey}-01`).length;
      const installmentsDueThisMonth = cardInstallments.reduce((sum, transaction) => {
        if (getMonthKeyFromDate(transaction.date) === selectedMonthKey) {
          return sum + transaction.amount;
        }
        return sum;
      }, 0);
      const installmentsDueThisMonthCount = cardInstallments.filter((transaction) => getMonthKeyFromDate(transaction.date) === selectedMonthKey).length;

      return {
        cardName,
        debt,
        monthlyPurchases,
        monthlyPayments,
        installmentsDueThisMonth,
        installmentsDueThisMonthCount,
        futureInstallments,
        futureInstallmentsCount,
      };
    });
  }, [cardNames, creditCardTransactions, projectedInstallments, selectedMonthKey]);

  const visibleSummaries = selectedCard === "all"
    ? summaries
    : summaries.filter((summary) => summary.cardName === selectedCard);

  const monthPurchases = filteredRealTransactions.filter((transaction) =>
    isExecutedTransaction(transaction) &&
    transaction.movementType === "expense" &&
    transaction.paymentMethod === "credit_card" &&
    getMonthKeyFromDate(transaction.date) === selectedMonthKey,
  );

  const monthPayments = filteredRealTransactions.filter((transaction) =>
    isExecutedTransaction(transaction) &&
    transaction.movementType === "credit_card_payment" &&
    getMonthKeyFromDate(transaction.date) === selectedMonthKey,
  );

  const futureInstallmentRows = useMemo<InstallmentProjectionRow[]>(
    () =>
      filteredProjectedInstallments
        .filter((transaction) => transaction.date >= `${selectedMonthKey}-01`)
        .map((transaction) => {
          const sourceId = transaction.id.replace(/-installment-\d+$/, "");
          const sourceTransaction = normalizedTransactions.find((candidate) => candidate.id === sourceId) ?? null;
          return {
            ...transaction,
            sourceTransaction,
          };
        })
        .sort((left, right) => left.date.localeCompare(right.date)),
    [filteredProjectedInstallments, normalizedTransactions, selectedMonthKey],
  );

  const futureVisibleIds = useMemo(
    () => futureInstallmentRows.map((transaction) => transaction.id),
    [futureInstallmentRows],
  );
  const allFutureSelected = futureVisibleIds.length > 0 && futureVisibleIds.every((id) => selectedFutureIds.has(id));
  const someFutureSelected = futureVisibleIds.some((id) => selectedFutureIds.has(id));
  const selectedFutureSourceIds = useMemo(
    () =>
      Array.from(new Set(
        futureInstallmentRows
          .filter((transaction) => selectedFutureIds.has(transaction.id))
          .map((transaction) => transaction.sourceTransaction?.id)
          .filter((id): id is string => Boolean(id)),
      )),
    [futureInstallmentRows, selectedFutureIds],
  );

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.type === "expense").map((category) => category.name).sort((left, right) => left.localeCompare(right, "es")),
    [categories],
  );

  const importBatches = useMemo<ImportBatchSummary[]>(() => {
    const grouped = new Map<string, ImportBatchSummary>();

    for (const transaction of normalizedTransactions) {
      if (!transaction.importBatchId || !transaction.importedAt) continue;
      if (!transaction.creditCardName) continue;
      if (selectedCard !== "all" && transaction.creditCardName !== selectedCard) continue;

      const current = grouped.get(transaction.importBatchId);
      if (current) {
        current.rows += 1;
        current.totalAmount += transaction.amount;
        continue;
      }

      grouped.set(transaction.importBatchId, {
        id: transaction.importBatchId,
        label: transaction.importBatchLabel ?? "Importación",
        importedAt: transaction.importedAt,
        cardName: transaction.creditCardName,
        rows: 1,
        totalAmount: transaction.amount,
      });
    }

    return Array.from(grouped.values()).sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  }, [normalizedTransactions, selectedCard]);
  const latestImportBatchId = importBatches[0]?.id ?? null;

  const paymentAccountLabelByCard = useMemo(() => {
    const labels = new Map<string, string>();

    for (const cardName of cardNames) {
      const matchedSetting = creditCardSettings.find((setting) => setting.cardName === cardName);
      const linkedAccount = matchedSetting?.defaultPaymentAccountId
        ? accountById.get(matchedSetting.defaultPaymentAccountId)
        : null;
      labels.set(cardName, linkedAccount ? accountDisplayName(linkedAccount) : "");
    }

    return labels;
  }, [accountById, cardNames, creditCardSettings]);

  const cardsWithoutPaymentAccount = useMemo(
    () => cardNames.filter((cardName) => !paymentAccountLabelByCard.get(cardName)),
    [cardNames, paymentAccountLabelByCard],
  );

  useEffect(() => {
    if (!editingTransaction) return;
    setEditName(editingTransaction.name);
    setEditCategory(editingTransaction.category);
    setEditAmount(String(editingTransaction.amount));
    setEditDate(editingTransaction.date);
    setEditInstallments(String(editingTransaction.installmentCount ?? 1));
  }, [editingTransaction]);

  const openEditDialog = (transaction: ReturnType<typeof normalizeTransaction>) => {
    setEditingTransaction(transaction);
  };

  const handleSaveEdit = () => {
    if (!editingTransaction) return;

    const amount = Number.parseInt(editAmount, 10);
    const installments = Number.parseInt(editInstallments, 10);

    if (!editName.trim() || !editCategory.trim() || !editDate || !Number.isFinite(amount) || amount <= 0) {
      toast({
        title: "Faltan datos",
        description: "Completa nombre, categoría, monto y fecha válidos.",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate(
      {
        id: editingTransaction.id,
        data: {
          name: editName.trim(),
          category: editCategory,
          amount,
          date: editDate,
          installmentCount: Number.isFinite(installments) && installments > 0 ? installments : 1,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Compra actualizada" });
          setEditingTransaction(null);
        },
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTransaction) return;
    deleteMutation.mutate(deleteTransaction.id, {
      onSuccess: () => {
        toast({ title: "Compra eliminada" });
        setDeleteTransaction(null);
      },
    });
  };

  const handleDeleteImportBatch = (batchId: string) => {
    const ids = normalizedTransactions
      .filter((transaction) => transaction.importBatchId === batchId)
      .map((transaction) => transaction.id);

    if (ids.length === 0) return;

    bulkDeleteMutation.mutate(ids, {
      onSuccess: (data) => {
        toast({ title: `Importación eliminada`, description: `${data.deleted} movimientos borrados.` });
      },
    });
  };

  const toggleSelectAllFuture = () => {
    if (allFutureSelected) {
      setSelectedFutureIds(new Set());
      return;
    }
    setSelectedFutureIds(new Set(futureVisibleIds));
  };

  const toggleSelectFuture = (id: string) => {
    setSelectedFutureIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkDeleteFuture = () => {
    const sourceIds = selectedFutureSourceIds;

    if (sourceIds.length === 0) {
      toast({
        title: "Sin selección válida",
        description: "Selecciona al menos una cuota futura con compra base asociada.",
        variant: "destructive",
      });
      return;
    }

    bulkDeleteMutation.mutate(sourceIds, {
      onSuccess: (data) => {
        setSelectedFutureIds(new Set());
        toast({ title: "Cuotas eliminadas", description: `${data.deleted} compras base eliminadas.` });
      },
    });
  };

  const totals = visibleSummaries.reduce(
    (acc, summary) => {
      acc.debt += summary.debt;
      acc.monthlyPurchases += summary.monthlyPurchases;
      acc.monthlyPayments += summary.monthlyPayments;
      acc.installmentsDueThisMonth += summary.installmentsDueThisMonth;
      acc.installmentsDueThisMonthCount += summary.installmentsDueThisMonthCount;
      acc.futureInstallments += summary.futureInstallments;
      acc.futureInstallmentsCount += summary.futureInstallmentsCount;
      return acc;
    },
    {
      debt: 0,
      monthlyPurchases: 0,
      monthlyPayments: 0,
      installmentsDueThisMonth: 0,
      installmentsDueThisMonthCount: 0,
      futureInstallments: 0,
      futureInstallmentsCount: 0,
    },
  );
  const selectedPeriodLabel = getPeriodLabel(selectedMonth, selectedYear);
  const selectedSummary = selectedCard === "all"
    ? null
    : summaries.find((summary) => summary.cardName === selectedCard) ?? null;
  const selectedPaymentAccountLabel = selectedCard === "all" ? "" : paymentAccountLabelByCard.get(selectedCard) ?? "";
  const hasPaymentAccountAlert = selectedCard === "all"
    ? cardsWithoutPaymentAccount.length > 0
    : !selectedPaymentAccountLabel;
  const workspaceTitle = selectedCard === "all" ? "Todas las tarjetas" : selectedCard;
  const monthlyNet = totals.monthlyPurchases - totals.monthlyPayments;
  const visiblePurchasesTotal = monthPurchases.reduce((sum, transaction) => sum + transaction.amount, 0);
  const visiblePaymentsTotal = monthPayments.reduce((sum, transaction) => sum + transaction.amount, 0);
  const visibleFutureInstallmentsTotal = futureInstallmentRows.reduce((sum, transaction) => sum + transaction.amount, 0);

  const handleSavePaymentAccount = (cardName: string) => {
    const selectedAccountId = paymentAccountDrafts[cardName];
    const matchedSetting = creditCardSettings.find((setting) => setting.cardName === cardName);
    const linkedAccount = bankAccounts.find((account) => account.id === selectedAccountId);
    const payload = {
      cardName,
      defaultPaymentAccountId: selectedAccountId && selectedAccountId !== "none" ? selectedAccountId : null,
      workspace: linkedAccount?.workspace ?? matchedSetting?.workspace ?? "family",
      isActive: true,
    };

    if (matchedSetting) {
      updateCreditCardSettingMutation.mutate(
        { id: matchedSetting.id, data: payload },
        {
          onSuccess: () => {
            toast({
              title: "Cuenta vinculada",
              description: `La tarjeta ${cardName} ya tiene cuenta de pago por defecto guardada.`,
            });
          },
        },
      );
      return;
    }

    createCreditCardSettingMutation.mutate(payload, {
      onSuccess: () => {
        toast({
          title: "Vinculación creada",
          description: `La tarjeta ${cardName} ya quedó asociada a su cuenta de pago por defecto.`,
        });
      },
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-56 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <CreditCard className="size-5 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">Tarjetas de crédito</h2>
            <p className="text-sm text-muted-foreground">Compromisos, pagos y cuotas para {selectedPeriodLabel.toLowerCase()}.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/movements">
              <ArrowRight className="size-4 mr-2" />
              Revisar movimientos
            </Link>
          </Button>
          <Button size="sm" onClick={openImportWizard}>
              <Upload className="size-4 mr-2" />
              Importar cartola
          </Button>
        </div>
      </div>

      <Card data-testid="credit-card-workspace-header">
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-2">
                <Badge variant="secondary" className="w-fit">
                  Workspace tarjetas
                </Badge>
                <div>
                  <h3 className="text-lg font-semibold">{workspaceTitle}</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedCard === "all"
                      ? `${visibleSummaries.length} tarjetas activas en el filtro actual.`
                      : selectedPaymentAccountLabel
                        ? `Pago por defecto desde ${selectedPaymentAccountLabel}.`
                        : "Esta tarjeta aún no tiene cuenta de pago por defecto."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3 xl:justify-end">
                <div className="space-y-1">
                  <span className="text-sm font-medium text-muted-foreground">Tarjeta</span>
                  <Select value={selectedCard} onValueChange={setSelectedCard}>
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las tarjetas</SelectItem>
                      {cardNames.map((cardName) => (
                        <SelectItem key={cardName} value={cardName}>
                          {cardName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <span className="text-sm font-medium text-muted-foreground">Mes</span>
                  <Select value={String(selectedMonth)} onValueChange={(value) => setSelectedMonth(parseInt(value, 10))}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.map((name, index) => (
                        <SelectItem key={name} value={String(index + 1)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <span className="text-sm font-medium text-muted-foreground">Año</span>
                  <Select value={String(selectedYear)} onValueChange={(value) => setSelectedYear(parseInt(value, 10))}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem key={year} value={String(year)}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-background p-4">
                <p className="text-sm text-muted-foreground">Saldo TC calculado</p>
                <p className={cn("text-2xl font-semibold tabular-nums mt-1", totals.debt >= 0 ? "text-zinc-700 dark:text-zinc-300" : "text-[hsl(var(--money-in))]")}>
                  {formatCLP(totals.debt)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Histórico registrado menos pagos cargados.</p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="text-sm text-muted-foreground">Compromiso del mes</p>
                <p className="text-2xl font-semibold tabular-nums mt-1">{formatCLP(totals.installmentsDueThisMonth)}</p>
                <p className="text-xs text-muted-foreground mt-1">{totals.installmentsDueThisMonthCount} cuotas en {MONTH_NAMES[selectedMonth - 1].toLowerCase()}.</p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="text-sm text-muted-foreground">Pagos cargados</p>
                <p className="text-2xl font-semibold tabular-nums mt-1">{formatCLP(totals.monthlyPayments)}</p>
                <p className="text-xs text-muted-foreground mt-1">Abonos reales importados o registrados.</p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="text-sm text-muted-foreground">Balance del mes</p>
                <p className={cn("text-2xl font-semibold tabular-nums mt-1", monthlyNet > 0 ? "text-zinc-700 dark:text-zinc-300" : "text-[hsl(var(--money-in))]")}>
                  {formatCLP(monthlyNet)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Compras menos pagos del periodo.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">Tarjetas activas</h4>
                  {selectedCard !== "all" ? (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedCard("all")}>
                      Ver todas
                    </Button>
                  ) : null}
                </div>
                {summaries.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    No hay tarjetas registradas. Importa una cartola o configura una tarjeta para activar este workspace.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {summaries.map((summary) => {
                      const isActive = selectedCard === summary.cardName;
                      const paymentLabel = paymentAccountLabelByCard.get(summary.cardName);
                      return (
                        <button
                          key={summary.cardName}
                          type="button"
                          onClick={() => setSelectedCard(summary.cardName)}
                          className={cn(
                            "rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isActive ? "border-primary bg-primary/5" : "border-border",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium leading-tight">{summary.cardName}</span>
                            {paymentLabel ? (
                              <Badge variant="secondary" className="shrink-0">
                                Cuenta OK
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="shrink-0 border-zinc-300 text-zinc-700 dark:text-zinc-300">
                                Sin cuenta
                              </Badge>
                            )}
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                            <span>Saldo</span>
                            <span className="text-right tabular-nums text-foreground">{formatCLP(summary.debt)}</span>
                            <span>Cuotas mes</span>
                            <span className="text-right tabular-nums text-foreground">{formatCLP(summary.installmentsDueThisMonth)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-background p-4">
                <div className="flex items-center gap-2">
                  {hasPaymentAccountAlert ? (
                    <AlertTriangle className="size-4 text-zinc-600" />
                  ) : (
                    <CheckCircle2 className="size-4 text-lime-600" />
                  )}
                  <h4 className="text-sm font-semibold">Estado operativo</h4>
                </div>
                <div className="mt-3 space-y-3 text-sm">
                  {selectedCard === "all" ? (
                    <div className="flex gap-2">
                      <Landmark className="size-4 mt-0.5 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        {cardsWithoutPaymentAccount.length === 0
                          ? "Todas las tarjetas tienen cuenta de pago por defecto."
                          : `${cardsWithoutPaymentAccount.length} tarjetas aún necesitan cuenta de pago por defecto.`}
                      </p>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Landmark className="size-4 mt-0.5 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        {selectedPaymentAccountLabel
                          ? selectedPaymentAccountLabel
                          : "Define una cuenta origen para que los pagos TC importados se vinculen solos."}
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <CalendarClock className="size-4 mt-0.5 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      {selectedSummary
                        ? `${selectedSummary.installmentsDueThisMonthCount} cuotas de ${selectedSummary.cardName} vencen en ${MONTH_NAMES[selectedMonth - 1].toLowerCase()}.`
                        : `${totals.installmentsDueThisMonthCount} cuotas vencen en ${MONTH_NAMES[selectedMonth - 1].toLowerCase()} entre todas las tarjetas.`}
                    </p>
                  </div>
                  {totals.debt > 0 ? (
                    <div className="rounded-md bg-zinc-50 p-3 text-zinc-900 dark:bg-zinc-950/40 dark:text-zinc-200">
                      Hay saldo de tarjeta abierto. Revisa pagos cargados antes de cerrar el mes.
                    </div>
                  ) : (
                    <div className="rounded-md bg-lime-50 p-3 text-lime-900 dark:bg-lime-950/40 dark:text-lime-200">
                      No hay saldo abierto en el filtro actual.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Cuenta de pago por tarjeta</CardTitle>
          <CardDescription>
            Esta relación se usa para que los pagos TC importados queden vinculados automáticamente a la cuenta corriente desde la que salen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarjeta</TableHead>
                <TableHead>Cuenta por defecto</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cardNames.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                    Aún no hay tarjetas registradas para vincular.
                  </TableCell>
                </TableRow>
              ) : cardNames.map((cardName) => (
                <TableRow key={cardName}>
                  <TableCell className="font-medium">{cardName}</TableCell>
                  <TableCell>
                    <Select
                      value={paymentAccountDrafts[cardName] ?? "none"}
                      onValueChange={(value) =>
                        setPaymentAccountDrafts((current) => ({ ...current, [cardName]: value }))
                      }
                    >
                      <SelectTrigger className="w-full max-w-md">
                        <SelectValue placeholder="Seleccionar cuenta" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin cuenta por defecto</SelectItem>
                        {bankAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name} — {account.bank}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSavePaymentAccount(cardName)}
                      disabled={createCreditCardSettingMutation.isPending || updateCreditCardSettingMutation.isPending}
                    >
                      Guardar vínculo
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Resumen por tarjeta</CardTitle>
          <CardDescription>Deuda, compromiso del mes, pagos y cuotas futuras por cada tarjeta.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarjeta</TableHead>
                <TableHead className="text-right">Deuda actual</TableHead>
                <TableHead className="text-right">Compromiso mes</TableHead>
                <TableHead className="text-right">Compras del mes</TableHead>
                <TableHead className="text-right">Pagos del mes</TableHead>
                <TableHead className="text-right">Cuotas futuras</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSummaries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No hay tarjetas con movimientos para este filtro.
                  </TableCell>
                </TableRow>
              ) : visibleSummaries.map((summary) => (
                <TableRow key={summary.cardName}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{summary.cardName}</span>
                      {summary.futureInstallmentsCount > 0 ? (
                        <Badge variant="secondary">{summary.futureInstallmentsCount} cuotas</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.debt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.installmentsDueThisMonth)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.monthlyPurchases)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.monthlyPayments)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.futureInstallments)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => setSelectedCard(summary.cardName)}
                      aria-label={`Abrir ${summary.cardName}`}
                    >
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {visibleSummaries.length > 0 ? (
              <TableFooter>
                <TableRow>
                  <TableCell>Total visible</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(totals.debt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(totals.installmentsDueThisMonth)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(totals.monthlyPurchases)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(totals.monthlyPayments)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(totals.futureInstallments)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Últimas importaciones</CardTitle>
          <CardDescription>
            Aquí puedes ubicar lotes importados desde cartolas y eliminar una carga completa si entró mal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Importación</TableHead>
                <TableHead>Tarjeta</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Filas</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importBatches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    No hay importaciones registradas para este filtro.
                  </TableCell>
                </TableRow>
              ) : importBatches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">{batch.label}</TableCell>
                  <TableCell>{batch.cardName}</TableCell>
                  <TableCell>{batch.importedAt.slice(0, 16).replace("T", " ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{batch.rows}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(batch.totalAmount)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={batch.id === latestImportBatchId ? "destructive" : "outline"}
                      size="sm"
                      onClick={() => setBatchToDelete(batch)}
                      disabled={bulkDeleteMutation.isPending}
                    >
                      {batch.id === latestImportBatchId ? "Deshacer" : "Eliminar con alerta"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Compras del mes</CardTitle>
            <CardDescription>Gastos reales cargados con tarjeta en el período.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tarjeta</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Detalle</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthPurchases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                      No hay compras con tarjeta en este período.
                    </TableCell>
                  </TableRow>
                ) : monthPurchases
                  .sort((left, right) => left.date.localeCompare(right.date))
                  .map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>{transaction.date}</TableCell>
                      <TableCell>{transaction.creditCardName}</TableCell>
                      <TableCell>{transaction.category}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{transaction.name}</span>
                          {transaction.installmentCount && transaction.installmentCount > 1 ? (
                            <span className="text-xs text-muted-foreground">{transaction.installmentCount} cuotas</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCLP(transaction.amount)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
              {monthPurchases.length > 0 ? (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4}>Total compras visibles</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(visiblePurchasesTotal)}</TableCell>
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Pagos realizados</CardTitle>
            <CardDescription>Abonos o pagos reales registrados para cada tarjeta.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tarjeta</TableHead>
                  <TableHead>Detalle</TableHead>
                  <TableHead>Ámbito</TableHead>
                  <TableHead>Cuenta origen</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthPayments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      No hay pagos de tarjeta en este período.
                    </TableCell>
                  </TableRow>
                ) : monthPayments
                  .sort((left, right) => left.date.localeCompare(right.date))
                  .map((transaction) => {
                    const sourceAccount = transaction.accountId ? accountById.get(transaction.accountId) : null;
                    return (
                      <TableRow key={transaction.id}>
                        <TableCell>{transaction.date}</TableCell>
                        <TableCell>{transaction.creditCardName}</TableCell>
                        <TableCell>{transaction.name}</TableCell>
                        <TableCell>{getWorkspaceLabel(transaction.workspace)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {sourceAccount ? accountDisplayName(sourceAccount) : "Sin cuenta vinculada"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCLP(transaction.amount)}</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
              {monthPayments.length > 0 ? (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5}>Total pagos visibles</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(visiblePaymentsTotal)}</TableCell>
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Cuotas futuras</CardTitle>
              <CardDescription>Proyección automática de cuotas desde el período seleccionado en adelante.</CardDescription>
            </div>
            {selectedFutureIds.size > 0 ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDeleteFuture}
                disabled={bulkDeleteMutation.isPending || selectedFutureSourceIds.length === 0}
              >
                {bulkDeleteMutation.isPending
                  ? "Eliminando..."
                  : `Eliminar ${selectedFutureSourceIds.length} ${selectedFutureSourceIds.length === 1 ? "compra base" : "compras base"}`}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allFutureSelected ? true : someFutureSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAllFuture}
                    aria-label="Seleccionar todas las cuotas futuras"
                  />
                </TableHead>
                <TableHead>Fecha proyectada</TableHead>
                <TableHead>Tarjeta</TableHead>
                <TableHead>Detalle cuota</TableHead>
                <TableHead>Descripción compra</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead>Ámbito</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {futureInstallmentRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                    No hay cuotas futuras para este filtro.
                  </TableCell>
                </TableRow>
              ) : futureInstallmentRows.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedFutureIds.has(transaction.id)}
                      onCheckedChange={() => toggleSelectFuture(transaction.id)}
                      aria-label={`Seleccionar cuota ${transaction.name}`}
                    />
                  </TableCell>
                  <TableCell>{transaction.date}</TableCell>
                  <TableCell>{transaction.creditCardName}</TableCell>
                  <TableCell>{transaction.name}</TableCell>
                  <TableCell>{transaction.sourceTransaction?.name ?? "-"}</TableCell>
                  <TableCell>{transaction.sourceTransaction?.category ?? transaction.notes?.replace("Proyección automática de cuotas para ", "") ?? "-"}</TableCell>
                  <TableCell>{getWorkspaceLabel(transaction.workspace)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(transaction.amount)}</TableCell>
                  <TableCell className="text-right">
                    {transaction.sourceTransaction ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEditDialog(transaction.sourceTransaction!)}
                          aria-label={`Editar ${transaction.sourceTransaction.name}`}
                        >
                          <Pencil className="size-4 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setDeleteTransaction(transaction.sourceTransaction!)}
                          aria-label={`Eliminar ${transaction.sourceTransaction.name}`}
                        >
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {futureInstallmentRows.length > 0 ? (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={7}>Total cuotas visibles</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(visibleFutureInstallmentsTotal)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editingTransaction} onOpenChange={(open) => { if (!open) setEditingTransaction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar compra base</DialogTitle>
            <DialogDescription>
              Este cambio actualiza la compra original y recalcula las cuotas futuras.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <span className="text-sm text-muted-foreground">Descripción</span>
              <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <span className="text-sm text-muted-foreground">Categoría</span>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {expenseCategories.map((categoryName) => (
                    <SelectItem key={categoryName} value={categoryName}>
                      {categoryName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="grid gap-2">
                <span className="text-sm text-muted-foreground">Monto</span>
                <Input value={editAmount} onChange={(event) => setEditAmount(event.target.value)} inputMode="numeric" />
              </div>
              <div className="grid gap-2">
                <span className="text-sm text-muted-foreground">Fecha</span>
                <Input type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <span className="text-sm text-muted-foreground">Cuotas</span>
                <Input value={editInstallments} onChange={(event) => setEditInstallments(event.target.value)} inputMode="numeric" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingTransaction(null)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTransaction} onOpenChange={(open) => { if (!open) setDeleteTransaction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar compra base</AlertDialogTitle>
            <AlertDialogDescription>
              Esto eliminará la compra original y también desaparecerán sus cuotas futuras proyectadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!batchToDelete} onOpenChange={(open) => { if (!open) setBatchToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {batchToDelete?.id === latestImportBatchId ? "Deshacer última importación" : "Eliminar una importación anterior"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {batchToDelete
                ? `${batchToDelete.label} contiene ${batchToDelete.rows} movimientos por ${formatCLP(batchToDelete.totalAmount)}. Al eliminarla también desaparecerán sus transacciones en Resumen y en las demás vistas.`
                : "Al eliminar esta importación también desaparecerán sus transacciones en Resumen y en las demás vistas."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (batchToDelete) handleDeleteImportBatch(batchToDelete.id);
                setBatchToDelete(null);
              }}
            >
              {batchToDelete?.id === latestImportBatchId ? "Deshacer lote" : "Eliminar lote"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
