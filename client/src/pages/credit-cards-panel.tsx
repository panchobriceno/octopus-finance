import { useEffect, useMemo, useState } from "react";
import { CreditCard, Upload } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTransactions } from "@/lib/hooks";
import { buildCreditCardInstallmentProjectionTransactions, getMonthKeyFromDate, isExecutedTransaction, normalizeTransaction } from "@/lib/finance";
import { getCreditCards } from "@/lib/credit-cards";
import { formatCLP } from "@/lib/utils";

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

export default function CreditCardsPanelPage() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [savedCards, setSavedCards] = useState<string[]>([]);
  const [selectedCard, setSelectedCard] = useState<string>("all");

  const { data: transactions = [], isLoading } = useTransactions();

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

  const futureInstallmentRows = filteredProjectedInstallments
    .filter((transaction) => transaction.date >= `${selectedMonthKey}-01`)
    .sort((left, right) => left.date.localeCompare(right.date));

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
          <CardTitle className="text-base font-semibold">Cuotas futuras</CardTitle>
          <CardDescription>Proyección automática de cuotas desde el período seleccionado en adelante.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha proyectada</TableHead>
                <TableHead>Tarjeta</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead>Origen</TableHead>
                <TableHead>Ámbito</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {futureInstallmentRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    No hay cuotas futuras para este filtro.
                  </TableCell>
                </TableRow>
              ) : futureInstallmentRows.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>{transaction.date}</TableCell>
                  <TableCell>{transaction.creditCardName}</TableCell>
                  <TableCell>{transaction.name}</TableCell>
                  <TableCell>{transaction.notes?.replace("Proyección automática de cuotas para ", "") ?? "-"}</TableCell>
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
  );
}
