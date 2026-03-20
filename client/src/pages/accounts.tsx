import { useState } from "react";
import {
  useAccounts,
  useCreateAccount,
  useUpdateAccount,
  useDeleteAccount,
  useTransactions,
} from "@/lib/hooks";
import type { Account } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Landmark, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type AccountType = "checking" | "savings" | "credit_card";
type AccountWorkspace = "business" | "family" | "shared";

function formatCLP(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export default function AccountsPage() {
  const { toast } = useToast();
  const { data: accounts = [], isLoading } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const createMutation = useCreateAccount();
  const updateMutation = useUpdateAccount();
  const deleteMutation = useDeleteAccount();

  const [newName, setNewName] = useState("");
  const [newBank, setNewBank] = useState("");
  const [newType, setNewType] = useState<AccountType>("checking");
  const [newBalance, setNewBalance] = useState("");
  const [newWorkspace, setNewWorkspace] = useState<AccountWorkspace>("business");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    bank: "",
    type: "checking" as AccountType,
    workspace: "business" as AccountWorkspace,
    currentBalance: "",
    notes: "",
  });

  const calculatedBalanceByAccount = new Map(
    accounts.map((account) => {
      const movementDelta = transactions.reduce((sum, tx) => {
        const status = tx.status ?? "paid";
        const movementType = tx.movementType ?? (tx.type === "income" ? "income" : "expense");

        if (!(status === "paid" || status === "actual")) {
          return sum;
        }

        if (tx.accountId === account.id) {
          if (tx.type === "income") return sum + tx.amount;

          if (movementType === "transfer") return sum - tx.amount;
          if (movementType === "credit_card_payment") return sum - tx.amount;

          if (tx.type === "expense") return sum - tx.amount;
        }

        // Technical debt:
        // incoming transfers are currently matched by destinationWorkspace using the
        // destination account name as free text. When we add destinationAccountId,
        // this should be replaced by an ID-based match.
        if (movementType === "transfer" && tx.destinationWorkspace === account.name) {
          return sum + tx.amount;
        }

        return sum;
      }, 0);

      return [account.id, account.currentBalance + movementDelta];
    }),
  );

  const totals = accounts.reduce(
    (acc, account) => {
      const calculatedBalance = calculatedBalanceByAccount.get(account.id) ?? account.currentBalance;
      acc.base += account.currentBalance ?? 0;
      acc.calculated += calculatedBalance;
      acc.difference += calculatedBalance - account.currentBalance;
      return acc;
    },
    { base: 0, calculated: 0, difference: 0 },
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const currentBalance = Number(newBalance);

    if (!newName.trim() || !newBank.trim() || Number.isNaN(currentBalance)) {
      toast({
        title: "Faltan datos",
        description: "Completa nombre, banco y saldo actual.",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate(
      {
        name: newName.trim(),
        bank: newBank.trim(),
        type: newType,
        currentBalance,
        workspace: newWorkspace,
        isShared: newWorkspace === "shared",
      },
      {
        onSuccess: () => {
          setNewName("");
          setNewBank("");
          setNewType("checking");
          setNewBalance("");
          setNewWorkspace("business");
          toast({ title: "Cuenta creada" });
        },
      },
    );
  };

  const startEditAccount = (account: Account) => {
    setEditingId(account.id);
    setEditForm({
      name: account.name,
      bank: account.bank,
      type: (account.type as AccountType) ?? "checking",
      workspace: (account.workspace as AccountWorkspace) ?? "business",
      currentBalance: String(account.currentBalance ?? 0),
      notes: account.notes ?? "",
    });
  };

  const saveEditAccount = () => {
    if (!editingId) return;
    const currentBalance = Number(editForm.currentBalance);

    if (!editForm.name.trim() || !editForm.bank.trim() || Number.isNaN(currentBalance)) {
      toast({
        title: "Datos inválidos",
        description: "Completa nombre, banco y saldo base con valores válidos.",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate(
      {
        id: editingId,
        data: {
          name: editForm.name.trim(),
          bank: editForm.bank.trim(),
          type: editForm.type,
          workspace: editForm.workspace,
          currentBalance,
          isShared: editForm.workspace === "shared",
          notes: editForm.notes.trim() || null,
          updatedAt: new Date().toISOString().slice(0, 10),
        },
      },
      {
        onSuccess: () => {
          setEditingId(null);
          setEditForm({
            name: "",
            bank: "",
            type: "checking",
            workspace: "business",
            currentBalance: "",
            notes: "",
          });
          toast({ title: "Cuenta actualizada" });
        },
      },
    );
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <Landmark className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Cuentas</h2>
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Aquí puedes llevar tus cuentas bancarias y tarjetas como catálogo base. Por ahora la vista
        está pensada para crear cuentas nuevas, revisar las existentes y actualizar tanto sus
        datos base como el saldo cuando lo necesites.
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Plus className="size-4" />
            Nueva Cuenta
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Input
              placeholder="Nombre de la cuenta"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              id="new-account-name"
              data-testid="input-account-name"
            />
            <Input
              placeholder="Banco"
              value={newBank}
              onChange={(e) => setNewBank(e.target.value)}
              data-testid="input-account-bank"
            />
            <Select value={newType} onValueChange={(value) => setNewType(value as AccountType)}>
              <SelectTrigger data-testid="select-account-type">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checking">Cuenta corriente</SelectItem>
                <SelectItem value="savings">Cuenta de ahorro</SelectItem>
                <SelectItem value="credit_card">Tarjeta de crédito</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              step="0.01"
              placeholder="Saldo actual"
              value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              data-testid="input-account-balance"
            />
            <Select value={newWorkspace} onValueChange={(value) => setNewWorkspace(value as AccountWorkspace)}>
              <SelectTrigger data-testid="select-account-workspace">
                <SelectValue placeholder="Ámbito" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="business">Empresa</SelectItem>
                <SelectItem value="family">Familia</SelectItem>
                <SelectItem value="shared">Compartida</SelectItem>
              </SelectContent>
            </Select>
            <div className="md:col-span-2 xl:col-span-5">
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-create-account">
                Crear cuenta
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Cuentas existentes ({accounts.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table className="zebra-stripe" data-testid="table-accounts">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Cuenta</TableHead>
                <TableHead>Banco</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Ámbito</TableHead>
                <TableHead>Saldo base</TableHead>
                <TableHead>Saldo calculado</TableHead>
                <TableHead>Diferencia</TableHead>
                <TableHead>Actualizado</TableHead>
                <TableHead className="text-right pr-5">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => {
                const calculatedBalance = calculatedBalanceByAccount.get(account.id) ?? account.currentBalance;
                const difference = calculatedBalance - account.currentBalance;

                return (
                  <TableRow key={account.id}>
                    <TableCell className="pl-5">
                      {editingId === account.id ? (
                        <div className="space-y-2">
                          <Input
                            value={editForm.name}
                            onChange={(e) => setEditForm((current) => ({ ...current, name: e.target.value }))}
                            className="h-8"
                          />
                          <Input
                            value={editForm.notes}
                            onChange={(e) => setEditForm((current) => ({ ...current, notes: e.target.value }))}
                            className="h-8"
                            placeholder="Notas"
                          />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{account.name}</p>
                          {account.notes ? (
                            <p className="text-xs text-muted-foreground">{account.notes}</p>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === account.id ? (
                        <Input
                          value={editForm.bank}
                          onChange={(e) => setEditForm((current) => ({ ...current, bank: e.target.value }))}
                          className="h-8 min-w-[140px]"
                        />
                      ) : (
                        account.bank
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === account.id ? (
                        <Select
                          value={editForm.type}
                          onValueChange={(value) => setEditForm((current) => ({ ...current, type: value as AccountType }))}
                        >
                          <SelectTrigger className="h-8 min-w-[150px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="checking">Cuenta corriente</SelectItem>
                            <SelectItem value="savings">Cuenta de ahorro</SelectItem>
                            <SelectItem value="credit_card">Tarjeta de crédito</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          {account.type === "credit_card"
                            ? "Tarjeta de crédito"
                            : account.type === "savings"
                            ? "Ahorro"
                            : "Cuenta corriente"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === account.id ? (
                        <Select
                          value={editForm.workspace}
                          onValueChange={(value) => setEditForm((current) => ({ ...current, workspace: value as AccountWorkspace }))}
                        >
                          <SelectTrigger className="h-8 min-w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="business">Empresa</SelectItem>
                            <SelectItem value="family">Familia</SelectItem>
                            <SelectItem value="shared">Compartida</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          {account.workspace === "family"
                            ? "Familia"
                            : account.workspace === "shared"
                            ? "Compartida"
                            : "Empresa"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === account.id ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.currentBalance}
                          onChange={(e) => setEditForm((current) => ({ ...current, currentBalance: e.target.value }))}
                          className="h-8 w-36"
                          autoFocus
                          data-testid={`input-edit-balance-${account.id}`}
                        />
                      ) : (
                        <span className="text-sm font-medium">{formatCLP(account.currentBalance)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{formatCLP(calculatedBalance)}</span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-sm font-medium ${
                          difference > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : difference < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatCLP(difference)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {account.updatedAt || "—"}
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      {editingId === account.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={saveEditAccount}
                            data-testid={`button-save-account-${account.id}`}
                          >
                            <Check className="size-3.5 text-emerald-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => {
                              setEditingId(null);
                              setEditForm({
                                name: "",
                                bank: "",
                                type: "checking",
                                workspace: "business",
                                currentBalance: "",
                                notes: "",
                              });
                            }}
                          >
                            <X className="size-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => startEditAccount(account)}
                            data-testid={`button-edit-account-${account.id}`}
                          >
                            <Pencil className="size-3.5 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() =>
                              deleteMutation.mutate(account.id, {
                                onSuccess: () => toast({ title: "Cuenta eliminada" }),
                              })
                            }
                            data-testid={`button-delete-account-${account.id}`}
                          >
                            <Trash2 className="size-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

              {!isLoading && accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8">
                    <div className="flex flex-col items-center justify-center gap-3 text-center">
                      <p className="text-sm text-muted-foreground">Aún no hay cuentas creadas.</p>
                      <Button type="button" variant="outline" onClick={() => document.getElementById("new-account-name")?.focus()}>
                        Crear la primera cuenta
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow className="bg-muted/30 font-medium">
                  <TableCell className="pl-5">Total</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell>
                    <span className="text-sm font-medium">{formatCLP(totals.base)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{formatCLP(totals.calculated)}</span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`text-sm font-medium ${
                        totals.difference > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : totals.difference < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {formatCLP(totals.difference)}
                    </span>
                  </TableCell>
                  <TableCell />
                  <TableCell className="pr-5" />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
