import { useMemo, useState } from "react";
import { Plus, Search, Pencil, Trash2, X, Upload } from "lucide-react";
import type { Transaction } from "@shared/schema";
import {
  useTransactions,
  useCategories,
  useItems,
  useAccounts,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useBulkDeleteTransactions,
} from "@/lib/hooks";
import { useToast } from "@/hooks/use-toast";
import { buildTransactionPayload, getTransactionFormInitialValues } from "@/lib/transaction-form";
import { TransactionForm } from "@/pages/overview";
import { AmountText } from "@/components/finance/amount-text";
import { ImportWizardDialog } from "@/components/finance/import-wizard-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatDate } from "@/lib/utils";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function workspacePill(workspace?: string | null) {
  if (workspace === "family") return { label: "Familia", className: "bg-[#9ef0cf]/15 text-[#9ef0cf]" };
  if (workspace === "dentist" || workspace === "shared") return { label: "Consulta", className: "bg-amber-500/15 text-amber-300" };
  return { label: "Empresa", className: "bg-[#bb9eff]/15 text-[#d6c7ff]" };
}

function statusPill(status: string) {
  if (status === "paid") return { label: "Pagado", className: "bg-emerald-500/15 text-emerald-300" };
  if (status === "cancelled") return { label: "Anulado", className: "bg-muted text-muted-foreground" };
  return { label: "Pendiente", className: "bg-amber-500/15 text-amber-300" };
}

export default function TransactionsPage() {
  const { toast } = useToast();
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: items = [] } = useItems();
  const { data: accounts = [] } = useAccounts();
  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();
  const bulkDeleteMutation = useBulkDeleteTransactions();

  const [showCreate, setShowCreate] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [filterMonth, setFilterMonth] = useState("all");
  const [filterWorkspace, setFilterWorkspace] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");

  const categoryMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const itemMap = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const categoryNameToId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) map[c.name] = c.id;
    return map;
  }, [categories]);

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const tx of transactions) set.add(tx.date.slice(0, 7));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [transactions]);

  const categoryNames = useMemo(
    () => Array.from(new Set(transactions.map((tx) => tx.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [transactions],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return transactions
      .filter((tx) => {
        if (filterMonth !== "all" && !tx.date.startsWith(filterMonth)) return false;
        if (filterStatus !== "all" && tx.status !== filterStatus) return false;
        if (filterCategory !== "all" && tx.category !== filterCategory) return false;
        if (filterWorkspace !== "all") {
          const ws = tx.workspace ?? "business";
          if (filterWorkspace === "dentist" ? !(ws === "dentist" || ws === "shared") : ws !== filterWorkspace) return false;
        }
        if (needle) {
          const hay = `${tx.name} ${tx.category}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, search, filterMonth, filterStatus, filterCategory, filterWorkspace]);

  const visible = filtered.slice(0, 200);
  const allVisibleSelected = visible.length > 0 && visible.every((tx) => selectedIds.has(tx.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (visible.every((tx) => prev.has(tx.id))) return new Set();
      return new Set(visible.map((tx) => tx.id));
    });
  };

  const handleCreate = (formData: Parameters<typeof buildTransactionPayload>[0]) => {
    const { ok, message, payload } = buildTransactionPayload(formData, { categoryMap, itemMap });
    if (!ok) {
      toast({ title: "Faltan datos", description: message ?? undefined, variant: "destructive" });
      return;
    }
    createMutation.mutate(payload, {
      onSuccess: () => {
        setShowCreate(false);
        toast({ title: "Movimiento creado" });
      },
    });
  };

  const handleEdit = (formData: Parameters<typeof buildTransactionPayload>[0]) => {
    if (!editingTx) return;
    const { payload } = buildTransactionPayload(formData, { categoryMap, itemMap });
    updateMutation.mutate(
      { id: editingTx.id, data: payload },
      {
        onSuccess: () => {
          setEditingTx(null);
          toast({ title: "Movimiento actualizado" });
        },
      },
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-[#0f0c1c] text-[#f1e9fc]">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-6 lg:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Movimientos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Todos tus ingresos y gastos cargados. Buscá, filtrá, editá o eliminá.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowImportWizard(true)} data-testid="button-open-import-wizard">
              <Upload className="mr-2 size-4" />
              Importar cartola
            </Button>
            <Button onClick={() => setShowCreate(true)} data-testid="button-new-transaction">
              <Plus className="mr-2 size-4" />
              Nuevo movimiento
            </Button>
          </div>
        </div>

        <Card className="border-[#bb9eff]/10 bg-card/70">
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <div className="relative min-w-[180px] flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o categoría"
                className="pl-8"
                data-testid="input-search-transactions"
              />
            </div>
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-[150px]" data-testid="select-filter-month"><SelectValue placeholder="Mes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los meses</SelectItem>
                {months.map((m) => {
                  const [y, mm] = m.split("-");
                  return <SelectItem key={m} value={m}>{MONTH_NAMES[Number(mm) - 1]} {y}</SelectItem>;
                })}
              </SelectContent>
            </Select>
            <Select value={filterWorkspace} onValueChange={setFilterWorkspace}>
              <SelectTrigger className="w-[140px]" data-testid="select-filter-workspace"><SelectValue placeholder="Ámbito" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los ámbitos</SelectItem>
                <SelectItem value="business">Empresa</SelectItem>
                <SelectItem value="family">Familia</SelectItem>
                <SelectItem value="dentist">Consulta</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[130px]" data-testid="select-filter-status"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="paid">Pagado</SelectItem>
                <SelectItem value="pending">Pendiente</SelectItem>
                <SelectItem value="cancelled">Anulado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[160px]" data-testid="select-filter-category"><SelectValue placeholder="Categoría" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorías</SelectItem>
                {categoryNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {selectedIds.size > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[#ff6f8d]/30 bg-[#ff6f8d]/5 px-4 py-2.5" data-testid="bulk-bar">
            <span className="text-sm">{selectedIds.size} seleccionados</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                <X className="mr-1 size-4" /> Limpiar
              </Button>
              <Button
                size="sm"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={bulkDeleteMutation.isPending}
                onClick={() =>
                  bulkDeleteMutation.mutate(Array.from(selectedIds), {
                    onSuccess: (data) => {
                      setSelectedIds(new Set());
                      toast({ title: `${data.deleted} movimientos eliminados` });
                    },
                  })
                }
                data-testid="button-bulk-delete-transactions"
              >
                <Trash2 className="mr-1 size-4" /> Eliminar {selectedIds.size}
              </Button>
            </div>
          </div>
        ) : null}

        <Card className="border-[#bb9eff]/10 bg-card/70">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table data-testid="table-all-transactions">
                <TableHeader>
                  <TableRow className="border-white/7 hover:bg-transparent">
                    <TableHead className="w-10 pl-4">
                      <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} data-testid="checkbox-select-all-transactions" />
                    </TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Ámbito</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="w-20 pr-4 text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                        No hay movimientos para estos filtros.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visible.map((tx) => {
                      const isIncome = tx.type === "income";
                      const ws = workspacePill(tx.workspace);
                      const st = statusPill(tx.status);
                      return (
                        <TableRow key={tx.id} className="border-white/7 hover:bg-white/3" data-testid={`tx-row-${tx.id}`}>
                          <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(tx.id)}
                              onCheckedChange={() => toggleSelect(tx.id)}
                              data-testid={`checkbox-tx-${tx.id}`}
                            />
                          </TableCell>
                          <TableCell className="cursor-pointer" onClick={() => setEditingTx(tx)}>
                            <span className="block max-w-[320px] truncate text-sm font-semibold">{tx.name}</span>
                            <span className="block text-xs text-muted-foreground">{formatDate(tx.date)}</span>
                          </TableCell>
                          <TableCell className="cursor-pointer text-sm text-[#cfc7dd]" onClick={() => setEditingTx(tx)}>
                            {tx.category || "Sin categoría"}
                          </TableCell>
                          <TableCell>
                            <span className={`rounded-md px-2 py-1 text-xs font-bold ${ws.className}`}>{ws.label}</span>
                          </TableCell>
                          <TableCell>
                            <span className={`rounded-md px-2 py-1 text-xs font-bold ${st.className}`}>{st.label}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <AmountText value={isIncome ? tx.amount : -tx.amount} className="text-sm font-bold" />
                          </TableCell>
                          <TableCell className="pr-4">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditingTx(tx)} data-testid={`button-edit-tx-${tx.id}`} title="Editar">
                                <Pencil className="size-3.5 text-muted-foreground" />
                              </Button>
                              <Button variant="ghost" size="icon" className="size-8" onClick={() => setDeletingTx(tx)} data-testid={`button-delete-tx-${tx.id}`} title="Eliminar">
                                <Trash2 className="size-3.5 text-muted-foreground" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {filtered.length > visible.length ? (
              <p className="border-t border-white/7 p-3 text-center text-xs text-muted-foreground">
                Mostrando {visible.length} de {filtered.length}. Afiná los filtros para ver el resto.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Nuevo movimiento</DialogTitle>
            <DialogDescription>Registra un ingreso o gasto.</DialogDescription>
          </DialogHeader>
          <TransactionForm
            mode="create"
            categories={categories}
            items={items}
            accounts={accounts}
            isPending={createMutation.isPending}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingTx} onOpenChange={(open) => { if (!open) setEditingTx(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Editar movimiento</DialogTitle>
            <DialogDescription>Modifica los campos y guarda los cambios.</DialogDescription>
          </DialogHeader>
          {editingTx && (
            <TransactionForm
              key={editingTx.id}
              mode="edit"
              categories={categories}
              items={items}
              accounts={accounts}
              initialValues={getTransactionFormInitialValues(editingTx, categoryNameToId)}
              isPending={updateMutation.isPending}
              onSubmit={handleEdit}
              onCancel={() => setEditingTx(null)}
              onDelete={() => { const tx = editingTx; setEditingTx(null); setDeletingTx(tx); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingTx} onOpenChange={(open) => { if (!open) setDeletingTx(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar movimiento?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          {deletingTx ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{deletingTx.name}</p>
                <p className="text-xs text-muted-foreground">{formatDate(deletingTx.date)}</p>
              </div>
              <AmountText value={deletingTx.type === "income" ? deletingTx.amount : -deletingTx.amount} className="text-sm font-semibold" />
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-tx">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!deletingTx) return;
                deleteMutation.mutate(deletingTx.id, {
                  onSuccess: () => {
                    setDeletingTx(null);
                    toast({ title: "Movimiento eliminado" });
                  },
                });
              }}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-tx"
            >
              {deleteMutation.isPending ? "Eliminando..." : "Sí, eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportWizardDialog open={showImportWizard} onOpenChange={setShowImportWizard} />
    </div>
  );
}
