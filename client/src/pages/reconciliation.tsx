import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRightLeft,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  FileSearch,
  PlusCircle,
  Scale,
  Trash2,
  Wand2,
} from "lucide-react";
import type { Account, Transaction } from "@shared/schema";
import {
  useAccounts,
  useConfirmImportedMovementMatch,
  useConvertImportedMovement,
  useCreateTransaction,
  useDiscardImportedMovement,
  useImportBatches,
  useImportedMovements,
  useTransactions,
} from "@/lib/hooks";
import { getCurrentMonthKey, getMonthLabel } from "@/lib/finance";
import { formatCLP } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  buildAccountReconciliationWorkspace,
  getTransactionAccountImpact,
  type AccountReconciliationWorkspace,
  type ReconciliationRow,
  type ReconciliationStatus,
} from "@/domain/reconciliation";
import { accountDisplayName, isActiveAccount } from "@/domain/accounts";
import { openImportWizard } from "@/lib/import-wizard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

const STATUS_TONE: Record<ReconciliationStatus, string> = {
  confident_match: "bg-[rgba(205,250,70,0.14)] text-[#cdfa46]",
  possible_match: "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]",
  missing_transaction: "bg-[rgba(227,227,234,0.12)] text-[#e3e3ea]",
  possible_duplicate: "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]",
  resolved: "bg-[rgba(205,250,70,0.14)] text-[#cdfa46]",
  discarded: "bg-[rgba(138,138,148,0.1)] text-[#8a8a94]",
};

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${day}/${month}`;
}

function getMonthOptions(transactions: Transaction[], importedMovements: Array<{ date: string }>) {
  const keys = new Set<string>([getCurrentMonthKey()]);
  transactions.forEach((transaction) => {
    if (transaction.date) keys.add(transaction.date.slice(0, 7));
  });
  importedMovements.forEach((movement) => {
    if (movement.date) keys.add(movement.date.slice(0, 7));
  });
  return Array.from(keys).sort((left, right) => right.localeCompare(left)).slice(0, 18);
}

function isCashOrCardAccount(account: Account) {
  return isActiveAccount(account) && ["checking", "savings", "credit_card"].includes(account.type);
}

function lastDayOfMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

function adjustmentPayload(workspace: AccountReconciliationWorkspace) {
  const amount = Math.round(Math.abs(workspace.difference));
  const isIncome = workspace.difference > 0;
  const date = `${workspace.monthKey}-${String(lastDayOfMonth(workspace.monthKey)).padStart(2, "0")}`;

  return {
    name: `Ajuste conciliacion ${workspace.account.name} ${workspace.monthKey}`,
    category: "Otros",
    amount,
    type: isIncome ? "income" : "expense",
    date,
    notes: "Ajuste manual creado desde conciliacion.",
    subtype: "actual",
    status: "paid",
    itemId: null,
    workspace: workspace.account.workspace ?? "business",
    movementType: isIncome ? "income" : "expense",
    paymentMethod: "bank_account",
    destinationWorkspace: null,
    destinationAccountId: null,
    creditCardName: null,
    installmentCount: null,
    accountId: workspace.account.id,
    sourceClientPaymentId: null,
    importBatchId: null,
    importBatchLabel: null,
    importedAt: null,
  };
}

function rowActionLabel(row: ReconciliationRow) {
  if (row.status === "confident_match") return "Confirmar";
  if (row.status === "possible_match") return "Confirmar match";
  if (row.status === "possible_duplicate") return "Conciliar";
  return "Convertir";
}

export default function ReconciliationPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthKey());
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: transactions = [], isLoading: transactionsLoading } = useTransactions();
  const { data: importBatches = [], isLoading: batchesLoading } = useImportBatches();
  const { data: importedMovements = [], isLoading: movementsLoading } = useImportedMovements({ limitCount: 1500 });
  const confirmMatchMutation = useConfirmImportedMovementMatch();
  const convertMutation = useConvertImportedMovement();
  const discardMutation = useDiscardImportedMovement();
  const createTransactionMutation = useCreateTransaction();

  const accountOptions = useMemo(
    () =>
      accounts
        .filter(isCashOrCardAccount)
        .sort((left, right) => accountDisplayName(left).localeCompare(accountDisplayName(right), "es")),
    [accounts],
  );
  const selectedAccount = accountOptions.find((account) => account.id === selectedAccountId) ?? accountOptions[0] ?? null;
  const monthOptions = useMemo(() => getMonthOptions(transactions, importedMovements), [transactions, importedMovements]);

  useEffect(() => {
    if (!selectedAccountId && accountOptions[0]) {
      setSelectedAccountId(accountOptions[0].id);
    }
  }, [accountOptions, selectedAccountId]);

  const workspace = useMemo(
    () =>
      selectedAccount
        ? buildAccountReconciliationWorkspace({
            account: selectedAccount,
            accounts,
            monthKey: selectedMonth,
            transactions,
            importedMovements,
            importBatches,
          })
        : null,
    [selectedAccount, accounts, selectedMonth, transactions, importedMovements, importBatches],
  );
  const isLoading = accountsLoading || transactionsLoading || batchesLoading || movementsLoading;
  const canCreateAdjustment =
    Boolean(workspace) &&
    workspace!.account.type !== "credit_card" &&
    Math.abs(workspace!.difference) > 1 &&
    !createTransactionMutation.isPending;

  const handleConfirmMatch = async (row: ReconciliationRow) => {
    const transactionId = row.bestCandidate?.transaction.id ?? row.movement.duplicateTransactionId;
    if (!transactionId) return;
    try {
      await confirmMatchMutation.mutateAsync({ id: row.id, transactionId });
      toast({
        title: "Match confirmado",
        description: `${row.movement.description} quedo conciliado contra una transaccion existente.`,
      });
    } catch (error) {
      toast({
        title: "No se pudo confirmar",
        description: error instanceof Error ? error.message : "Intenta nuevamente.",
        variant: "destructive",
      });
    }
  };

  const handleConvert = async (row: ReconciliationRow) => {
    try {
      await convertMutation.mutateAsync({ id: row.id });
      toast({
        title: "Movimiento convertido",
        description: `${row.movement.description} ahora existe como transaccion.`,
      });
    } catch (error) {
      toast({
        title: "No se pudo convertir",
        description: error instanceof Error ? error.message : "Revisa el movimiento antes de convertir.",
        variant: "destructive",
      });
    }
  };

  const handleCreditCardPayment = async (row: ReconciliationRow) => {
    try {
      await convertMutation.mutateAsync({
        id: row.id,
        override: {
          movementType: "credit_card_payment",
          paymentMethod: "bank_account",
          category: "Tarjeta de credito",
          itemId: null, // un pago de tarjeta no lleva subcategoría; no arrastrar la sugerida
        },
      });
      toast({
        title: "Pago de tarjeta registrado",
        description: `${row.movement.description} quedo como pago de tarjeta.`,
      });
    } catch (error) {
      toast({
        title: "No se pudo marcar pago",
        description: error instanceof Error ? error.message : "Revisa tarjeta y cuenta antes de convertir.",
        variant: "destructive",
      });
    }
  };

  const handleDiscard = async (row: ReconciliationRow) => {
    try {
      await discardMutation.mutateAsync(row.id);
      toast({
        title: "Movimiento descartado",
        description: `${row.movement.description} quedo fuera de la conciliacion.`,
      });
    } catch (error) {
      toast({
        title: "No se pudo descartar",
        description: error instanceof Error ? error.message : "Intenta nuevamente.",
        variant: "destructive",
      });
    }
  };

  const handleCreateAdjustment = async () => {
    if (!workspace) return;
    try {
      await createTransactionMutation.mutateAsync(adjustmentPayload(workspace));
      setAdjustmentOpen(false);
      toast({
        title: "Ajuste creado",
        description: `Se creo un ajuste por ${formatCLP(Math.abs(workspace.difference))}.`,
      });
    } catch (error) {
      toast({
        title: "No se pudo crear ajuste",
        description: error instanceof Error ? error.message : "Intenta nuevamente.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="h-full overflow-auto bg-background p-4 md:p-6" data-testid="reconciliation-page">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Conciliacion</h1>
            <p className="text-sm text-muted-foreground">
              {selectedAccount ? accountDisplayName(selectedAccount) : "Selecciona una cuenta"} · {getMonthLabel(selectedMonth)}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={selectedAccount?.id ?? ""} onValueChange={setSelectedAccountId}>
              <SelectTrigger className="w-full sm:w-[300px]">
                <SelectValue placeholder="Cuenta" />
              </SelectTrigger>
              <SelectContent>
                {accountOptions.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {accountDisplayName(account)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Mes" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((monthKey) => (
                  <SelectItem key={monthKey} value={monthKey}>
                    {getMonthLabel(monthKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!workspace ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {isLoading ? "Cargando conciliacion..." : "No hay cuentas activas para conciliar."}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Card className="rounded-lg">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Saldo inicial</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-2xl font-semibold tabular-nums">{formatCLP(workspace.openingBalanceEstimate)}</div>
                  <div className="text-xs text-muted-foreground">Calculado desde saldo actual</div>
                </CardContent>
              </Card>
              <Card className="rounded-lg">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Cartola importada</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-2xl font-semibold tabular-nums">{formatCLP(workspace.importedNet)}</div>
                  <div className="text-xs text-muted-foreground">{workspace.importedCount} movimientos</div>
                </CardContent>
              </Card>
              <Card className="rounded-lg">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Registrado en app</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-2xl font-semibold tabular-nums">{formatCLP(workspace.registeredNet)}</div>
                  <div className="text-xs text-muted-foreground">{workspace.registeredCount} transacciones</div>
                </CardContent>
              </Card>
              <Card className="rounded-[18px] border-[#cdfa46]/30 bg-[rgba(205,250,70,0.05)]">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Diferencia</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className={Math.abs(workspace.difference) <= 1 ? "font-mono text-2xl font-bold tabular-nums text-[#cdfa46]" : "font-mono text-2xl font-bold tabular-nums text-[#e3e3ea]"}>
                    {formatCLP(workspace.difference)}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canCreateAdjustment}
                      onClick={() => setAdjustmentOpen(true)}
                    >
                      <PlusCircle className="mr-2 size-4" />
                      Crear ajuste
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <Card className="rounded-[18px]">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Confiables</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[#cdfa46]">{workspace.confidentMatchCount}</p>
                  </div>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-[rgba(205,250,70,0.12)] text-[#cdfa46]"><CheckCircle2 className="size-5" /></span>
                </CardContent>
              </Card>
              <Card className="rounded-[18px]">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Por revisar</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[#f4f4f7]">{workspace.unresolvedCount}</p>
                  </div>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-[#9a9aa6]"><CircleAlert className="size-5" /></span>
                </CardContent>
              </Card>
              <Card className="rounded-[18px]">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Sin cartola</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[#f4f4f7]">{workspace.unmatchedRegisteredCount}</p>
                  </div>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-[#9a9aa6]"><FileSearch className="size-5" /></span>
                </CardContent>
              </Card>
              <Card className="rounded-[18px]">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Lotes abiertos</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[#f4f4f7]">{workspace.openBatchCount}</p>
                  </div>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-[#9a9aa6]"><Scale className="size-5" /></span>
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-lg">
              <CardHeader className="flex flex-col gap-2 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Movimientos de cartola</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {workspace.rows.length} filas · {workspace.missingCount} sin registrar · {workspace.possibleMatchCount} posibles
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => navigate("/movements")}>
                    <ArrowRightLeft className="mr-2 size-4" />
                    Movimientos
                  </Button>
                  <Button variant="outline" size="sm" onClick={openImportWizard}>
                    <FileSearch className="mr-2 size-4" />
                    Importar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {workspace.rows.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No hay movimientos importados para esta cuenta y mes.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Cartola</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Match sugerido</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {workspace.rows.map((row) => {
                          const canConfirm =
                            Boolean(row.bestCandidate || row.movement.duplicateTransactionId) &&
                            ["confident_match", "possible_match", "possible_duplicate"].includes(row.status);
                          const canConvert = ["missing_transaction", "possible_match"].includes(row.status) && row.movement.status === "pending";
                          const isCreditCardPayment = row.movement.suggestedMovementType === "credit_card_payment";

                          return (
                            <TableRow key={row.id}>
                              <TableCell className="whitespace-nowrap text-sm">{formatDate(row.movement.date)}</TableCell>
                              <TableCell>
                                <div className="font-medium">{row.movement.description}</div>
                                <div className="text-xs text-muted-foreground">{row.batch?.label ?? row.movement.sourceName}</div>
                              </TableCell>
                              <TableCell>
                                <Badge className={STATUS_TONE[row.status]}>{row.statusLabel}</Badge>
                                {row.bestCandidate ? (
                                  <div className="mt-1 text-xs text-muted-foreground">{row.bestCandidate.score}%</div>
                                ) : null}
                              </TableCell>
                              <TableCell>
                                {row.bestCandidate ? (
                                  <div>
                                    <div className="text-sm font-medium">{row.bestCandidate.transaction.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {formatDate(row.bestCandidate.transaction.date)} · {row.bestCandidate.reasons.join(", ")}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-sm text-muted-foreground">Sin candidato</span>
                                )}
                              </TableCell>
                              <TableCell className={row.importedImpact >= 0 ? "text-right tabular-nums text-[hsl(var(--money-in))]" : "text-right tabular-nums text-[#e3e3ea]"}>
                                {formatCLP(row.importedImpact)}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap justify-end gap-2">
                                  {canConfirm ? (
                                    <Button
                                      size="sm"
                                      onClick={() => handleConfirmMatch(row)}
                                      disabled={confirmMatchMutation.isPending}
                                    >
                                      <CheckCircle2 className="mr-2 size-4" />
                                      {rowActionLabel(row)}
                                    </Button>
                                  ) : null}
                                  {canConvert ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleConvert(row)}
                                      disabled={convertMutation.isPending}
                                    >
                                      <Wand2 className="mr-2 size-4" />
                                      Convertir
                                    </Button>
                                  ) : null}
                                  {isCreditCardPayment && row.movement.status === "pending" ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleCreditCardPayment(row)}
                                      disabled={convertMutation.isPending}
                                    >
                                      <CreditCard className="mr-2 size-4" />
                                      Pago TC
                                    </Button>
                                  ) : null}
                                  {["pending", "duplicate"].includes(row.movement.status) ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDiscard(row)}
                                      disabled={discardMutation.isPending}
                                    >
                                      <Trash2 className="mr-2 size-4" />
                                      Omitir
                                    </Button>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader className="p-4">
                <CardTitle className="text-base font-semibold">Registradas sin cartola</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {workspace.unmatchedRegisteredTransactions.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No hay transacciones registradas fuera de la cartola seleccionada.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Transaccion</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Impacto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workspace.unmatchedRegisteredTransactions.slice(0, 12).map((transaction) => {
                        const impact = getTransactionAccountImpact(transaction, workspace.account, accounts);
                        return (
                          <TableRow key={transaction.id}>
                            <TableCell>{formatDate(transaction.date)}</TableCell>
                            <TableCell>
                              <div className="font-medium">{transaction.name}</div>
                              <div className="text-xs text-muted-foreground">{transaction.category}</div>
                            </TableCell>
                            <TableCell>{transaction.movementType ?? transaction.type}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCLP(impact)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <AlertDialog open={adjustmentOpen} onOpenChange={setAdjustmentOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Crear ajuste manual</AlertDialogTitle>
            <AlertDialogDescription>
              {workspace
                ? `Se creara una transaccion por ${formatCLP(Math.abs(workspace.difference))} para cuadrar ${accountDisplayName(workspace.account)} en ${getMonthLabel(workspace.monthKey)}.`
                : "Selecciona una cuenta para crear el ajuste."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreateAdjustment} disabled={!canCreateAdjustment}>
              Crear ajuste
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
