import { useState } from "react";
import {
  useAccounts,
  useCreateAccount,
  useUpdateAccount,
  useDeleteAccount,
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
  const createMutation = useCreateAccount();
  const updateMutation = useUpdateAccount();
  const deleteMutation = useDeleteAccount();

  const [newName, setNewName] = useState("");
  const [newBank, setNewBank] = useState("");
  const [newType, setNewType] = useState<AccountType>("checking");
  const [newBalance, setNewBalance] = useState("");
  const [newWorkspace, setNewWorkspace] = useState<AccountWorkspace>("business");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBalance, setEditBalance] = useState("");

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

  const startEditBalance = (account: Account) => {
    setEditingId(account.id);
    setEditBalance(String(account.currentBalance ?? 0));
  };

  const saveEditBalance = () => {
    if (!editingId) return;
    const currentBalance = Number(editBalance);

    if (Number.isNaN(currentBalance)) {
      toast({
        title: "Saldo inválido",
        description: "Ingresa un número válido para el saldo.",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate(
      {
        id: editingId,
        data: {
          currentBalance,
          updatedAt: new Date().toISOString().slice(0, 10),
        },
      },
      {
        onSuccess: () => {
          setEditingId(null);
          setEditBalance("");
          toast({ title: "Saldo actualizado" });
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
        está pensada para crear cuentas nuevas, revisar las existentes y actualizar el saldo actual
        cuando lo necesites.
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
                <TableHead>Saldo actual</TableHead>
                <TableHead>Actualizado</TableHead>
                <TableHead className="text-right pr-5">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="pl-5">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{account.name}</p>
                      {account.notes ? (
                        <p className="text-xs text-muted-foreground">{account.notes}</p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{account.bank}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {account.type === "credit_card"
                        ? "Tarjeta de crédito"
                        : account.type === "savings"
                        ? "Ahorro"
                        : "Cuenta corriente"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {account.workspace === "family"
                        ? "Familia"
                        : account.workspace === "shared"
                        ? "Compartida"
                        : "Empresa"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {editingId === account.id ? (
                      <Input
                        type="number"
                        step="0.01"
                        value={editBalance}
                        onChange={(e) => setEditBalance(e.target.value)}
                        className="h-8 w-36"
                        autoFocus
                        data-testid={`input-edit-balance-${account.id}`}
                      />
                    ) : (
                      <span className="text-sm font-medium">{formatCLP(account.currentBalance)}</span>
                    )}
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
                          onClick={saveEditBalance}
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
                            setEditBalance("");
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
                          onClick={() => startEditBalance(account)}
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
              ))}

              {!isLoading && accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                    No hay cuentas creadas todavía
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
