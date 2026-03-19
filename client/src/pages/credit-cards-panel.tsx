import { useEffect, useMemo, useState } from "react";
import { CreditCard, Upload, Pencil, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { useBulkDeleteTransactions, useCategories, useDeleteTransaction, useTransactions, useUpdateTransaction } from "@/lib/hooks";
import { buildCreditCardInstallmentProjectionTransactions, getMonthKeyFromDate, isExecutedTransaction, normalizeTransaction } from "@/lib/finance";
import { getCreditCards } from "@/lib/credit-cards";
import { formatCLP } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Transaction } from "@shared/schema";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type CardSummary = {
  cardName: string;
  debt: number;
  monthlyPurchases: number;
  monthlyPayments: number;
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

export default function CreditCardsPanelPage() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [savedCards, setSavedCards] = useState<string[]>([]);
  const [selectedCard, setSelectedCard] = useState<string>("all");
  const [editingTransaction, setEditingTransaction] = useState<ReturnType<typeof normalizeTransaction> | null>(null);
  const [deleteTransaction, setDeleteTransaction] = useState<ReturnType<typeof normalizeTransaction> | null>(null);
  const [selectedFutureIds, setSelectedFutureIds] = useState<Set<string>>(new Set());
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editInstallments, setEditInstallments] = useState("1");

  const { data: transactions = [], isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();
  const bulkDeleteMutation = useBulkDeleteTransactions();
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncCards = () => setSavedCards(getCreditCards());
    syncCards();
    window.addEventListener("octopus-credit-cards-updated", syncCards);
    return () => window.removeEventListener("octopus-credit-cards-updated", syncCards);
  }, []);

  const selectedMonthKey = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;

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
    if (selectedCard !== "all" && !cardNames.includes(selectedCard)) {
      setSelectedCard("all");
    }
  }, [cardNames, selectedCard]);

  const years = useMemo(() => {
    const set = new Set<number>([now.getFullYear()]);

    for (const transaction of creditCardTransactions) {
      set.add(parseInt(transaction.date.slice(0, 4), 10));
    }

    for (const transaction of projectedInstallments) {
      set.add(parseInt(transaction.date.slice(0, 4), 10));
    }

    return Array.from(set).sort((left, right) => right - left);
  }, [creditCardTransactions, now, projectedInstallments]);

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

      return {
        cardName,
        debt,
        monthlyPurchases,
        monthlyPayments,
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
    const sourceIds = Array.from(new Set(
      futureInstallmentRows
        .filter((transaction) => selectedFutureIds.has(transaction.id))
        .map((transaction) => transaction.sourceTransaction?.id)
        .filter((id): id is string => Boolean(id)),
    ));

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
      acc.futureInstallments += summary.futureInstallments;
      acc.futureInstallmentsCount += summary.futureInstallmentsCount;
      return acc;
    },
    {
      debt: 0,
      monthlyPurchases: 0,
      monthlyPayments: 0,
      futureInstallments: 0,
      futureInstallmentsCount: 0,
    },
  );

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
      <div className="flex items-center gap-3">
        <CreditCard className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Panel de Tarjetas</h2>
      </div>

      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
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

            <div className="flex flex-col gap-2 text-sm text-muted-foreground lg:items-end">
              <span>Esta vista usa compras reales, pagos reales y cuotas proyectadas.</span>
              <Button asChild variant="outline" size="sm" className="w-fit">
                <Link href="/import">
                  <Upload className="size-4 mr-2" />
                  Completar con cartolas
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Deuda actual</p>
            <p className={`text-xl font-semibold tabular-nums mt-1 ${totals.debt >= 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-400"}`}>
              {formatCLP(totals.debt)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Compras del mes</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{formatCLP(totals.monthlyPurchases)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Pagos realizados</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{formatCLP(totals.monthlyPayments)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Cuotas futuras</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{formatCLP(totals.futureInstallments)}</p>
            <p className="text-xs text-muted-foreground mt-1">{totals.futureInstallmentsCount} cuotas desde {MONTH_NAMES[selectedMonth - 1].toLowerCase()}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Resumen por tarjeta</CardTitle>
          <CardDescription>Deuda, compras del período, pagos y cuotas futuras por cada tarjeta.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarjeta</TableHead>
                <TableHead className="text-right">Deuda actual</TableHead>
                <TableHead className="text-right">Compras del mes</TableHead>
                <TableHead className="text-right">Pagos del mes</TableHead>
                <TableHead className="text-right">Cuotas futuras</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSummaries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
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
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.monthlyPurchases)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.monthlyPayments)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.futureInstallments)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
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
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteImportBatch(batch.id)}
                      disabled={bulkDeleteMutation.isPending}
                    >
                      {bulkDeleteMutation.isPending ? "Eliminando..." : "Eliminar lote"}
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
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthPayments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                      No hay pagos de tarjeta en este período.
                    </TableCell>
                  </TableRow>
                ) : monthPayments
                  .sort((left, right) => left.date.localeCompare(right.date))
                  .map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>{transaction.date}</TableCell>
                      <TableCell>{transaction.creditCardName}</TableCell>
                      <TableCell>{transaction.name}</TableCell>
                      <TableCell>
                        {transaction.workspace === "business"
                          ? "Empresa"
                          : transaction.workspace === "family"
                            ? "Familia"
                            : "Consulta Dentista"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCLP(transaction.amount)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
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
                disabled={bulkDeleteMutation.isPending}
              >
                {bulkDeleteMutation.isPending ? "Eliminando..." : `Eliminar ${selectedFutureIds.size}`}
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
                  <TableCell>
                    {transaction.workspace === "business"
                      ? "Empresa"
                      : transaction.workspace === "family"
                        ? "Familia"
                        : "Consulta Dentista"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(transaction.amount)}</TableCell>
                  <TableCell className="text-right">
                    {transaction.sourceTransaction ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEditDialog(transaction.sourceTransaction!)}
                        >
                          <Pencil className="size-4 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setDeleteTransaction(transaction.sourceTransaction!)}
                        >
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
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
    </div>
  );
}
