import { useMemo, useState } from "react";
import type { ClientPayment } from "@shared/schema";
import {
  useClientPayments,
  useClients,
  useCreateClient,
  useCreateClientPayment,
  useDeleteClientPayment,
  useUpdateClientPayment,
} from "@/lib/hooks";
import { formatCLP } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { BriefcaseBusiness, Check, Pencil, Plus, Trash2, X, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

type PaymentStatus = "projected" | "receivable" | "paid" | "cancelled";

const defaultForm = {
  clientId: "",
  clientName: "",
  rut: "",
  contactName: "",
  email: "",
  serviceItem: "",
  serviceMonth: "",
  issueDate: "",
  dueDate: "",
  netAmount: "",
  vatAmount: "",
  totalAmount: "",
  status: "receivable" as PaymentStatus,
};

type EditForm = {
  clientId: string;
  clientName: string;
  rut: string;
  contactName: string;
  email: string;
  serviceItem: string;
  serviceMonth: string;
  issueDate: string;
  dueDate: string;
  netAmount: string;
  vatAmount: string;
  totalAmount: string;
  status: PaymentStatus;
  notes: string;
};

function calculateVatAndTotal(netAmount: string) {
  const net = Number.parseFloat(netAmount || "0");
  const safeNet = Number.isFinite(net) ? net : 0;
  const vat = Math.round(safeNet * 0.19);
  return {
    vatAmount: String(vat),
    totalAmount: String(safeNet + vat),
  };
}

function buildEditForm(payment: ClientPayment): EditForm {
  return {
    clientId: payment.clientId ?? "",
    clientName: payment.clientName,
    rut: payment.rut ?? "",
    contactName: payment.contactName ?? "",
    email: payment.email ?? "",
    serviceItem: payment.serviceItem ?? "",
    serviceMonth: payment.serviceMonth ?? "",
    issueDate: payment.issueDate ?? "",
    dueDate: payment.dueDate ?? "",
    netAmount: String(payment.netAmount ?? 0),
    vatAmount: String(payment.vatAmount ?? 0),
    totalAmount: String(payment.totalAmount ?? 0),
    status: payment.status as PaymentStatus,
    notes: payment.notes ?? "",
  };
}

export default function ClientPaymentsPage() {
  const [form, setForm] = useState(defaultForm);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [showCreateClientForm, setShowCreateClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientRut, setNewClientRut] = useState("");
  const [newClientWorkspace, setNewClientWorkspace] = useState("business");
  const [sortField, setSortField] = useState<"clientName" | "rut" | "serviceItem" | "serviceMonth" | "issueDate" | "dueDate" | "status" | "netAmount" | "vatAmount" | "totalAmount">("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const { toast } = useToast();

  const { data: clients = [] } = useClients();
  const { data: payments = [], isLoading } = useClientPayments();
  const createClientMutation = useCreateClient();
  const createMutation = useCreateClientPayment();
  const updateMutation = useUpdateClientPayment();
  const deleteMutation = useDeleteClientPayment();

  const summary = useMemo(() => payments.reduce((acc, payment) => {
    if (payment.status === "cancelled") return acc;

    acc.totalNet += payment.netAmount;
    acc.totalVat += payment.vatAmount;
    acc.totalGross += payment.totalAmount;

    if (payment.status === "paid") acc.paid += payment.netAmount;
    if (payment.status === "receivable") acc.receivable += payment.netAmount;
    if (payment.status === "projected") acc.projected += payment.netAmount;

    return acc;
  }, {
    totalNet: 0,
    totalVat: 0,
    totalGross: 0,
    paid: 0,
    receivable: 0,
    projected: 0,
  }), [payments]);

  const sortedPayments = useMemo(
    () =>
      [...payments].sort((left, right) => {
        const getValue = (payment: ClientPayment) => {
          switch (sortField) {
            case "netAmount":
            case "vatAmount":
            case "totalAmount":
              return payment[sortField] ?? 0;
            default:
              return String(payment[sortField] ?? "");
          }
        };

        const leftValue = getValue(left);
        const rightValue = getValue(right);
        const comparison =
          typeof leftValue === "number" && typeof rightValue === "number"
            ? leftValue - rightValue
            : String(leftValue).localeCompare(String(rightValue));
        return sortDirection === "asc" ? comparison : -comparison;
      }),
    [payments, sortDirection, sortField],
  );

  const toggleSort = (field: typeof sortField) => {
    setSortField((currentField) => {
      if (currentField === field) {
        setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
        return currentField;
      }
      setSortDirection("asc");
      return field;
    });
  };

  const renderSortIcon = (field: typeof sortField) => {
    if (sortField !== field) return <ArrowUpDown className="size-3.5 text-muted-foreground" />;
    return sortDirection === "asc" ? (
      <ArrowUp className="size-3.5 text-muted-foreground" />
    ) : (
      <ArrowDown className="size-3.5 text-muted-foreground" />
    );
  };

  const handleChange = (field: keyof typeof defaultForm, value: string) => {
    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "netAmount") {
        const { vatAmount, totalAmount } = calculateVatAndTotal(next.netAmount);
        next.vatAmount = vatAmount;
        next.totalAmount = totalAmount;
      }

      return next;
    });
  };

  const handleClientSelection = (value: string) => {
    const selectedClient = clients.find((client) => client.id === value);
    setForm((current) => ({
      ...current,
      clientId: value,
      clientName: selectedClient?.name ?? current.clientName,
      rut: selectedClient?.rut ?? "",
      contactName: selectedClient?.contactName ?? "",
      email: selectedClient?.email ?? "",
    }));
  };

  const handleCreate = async () => {
    if (!form.clientName.trim() || !form.netAmount) return;

    let resolvedClientId: string | null = null;

    if (form.clientId) {
      resolvedClientId = form.clientId;
    }

    createMutation.mutate({
      clientId: resolvedClientId,
      clientName: form.clientName.trim(),
      rut: form.rut.trim() || null,
      contactName: form.contactName.trim() || null,
      email: form.email.trim() || null,
      accountManager: null,
      serviceItem: form.serviceItem || null,
      serviceMonth: form.serviceMonth || null,
      issueDate: form.issueDate || null,
      dueDate: form.dueDate || null,
      paymentDate: form.status === "paid" ? new Date().toISOString().slice(0, 10) : null,
      netAmount: Number.parseFloat(form.netAmount || "0"),
      vatAmount: Number.parseFloat(form.vatAmount || "0"),
      totalAmount: Number.parseFloat(form.totalAmount || "0"),
      status: form.status,
      notes: null,
      workspace: "business",
    }, {
      onSuccess: () => {
        toast({ title: "Ingreso cliente guardado" });
        setForm(defaultForm);
      },
    });
  };

  const handleQuickCreateClient = async () => {
    if (!newClientName.trim()) {
      toast({
        title: "Falta el nombre",
        description: "Ingresa el nombre del cliente antes de crearlo.",
        variant: "destructive",
      });
      return;
    }

    const createdClient = await createClientMutation.mutateAsync({
      name: newClientName.trim(),
      rut: newClientRut.trim() || null,
      workspace: newClientWorkspace,
    });

    setForm((current) => ({
      ...current,
      clientId: createdClient.id,
      clientName: newClientName.trim(),
      rut: createdClient.rut ?? "",
      contactName: createdClient.contactName ?? "",
      email: createdClient.email ?? "",
    }));
    setShowCreateClientForm(false);
    setNewClientName("");
    setNewClientRut("");
    setNewClientWorkspace("business");
    toast({ title: "Cliente creado" });
  };

  const handleStatusChange = (id: string, status: PaymentStatus) => {
    updateMutation.mutate({
      id,
      data: {
        status,
        paymentDate: status === "paid" ? new Date().toISOString().slice(0, 10) : null,
      },
    });
  };

  const startEdit = (payment: ClientPayment) => {
    setEditingPaymentId(payment.id);
    setEditForm(buildEditForm(payment));
  };

  const cancelEdit = () => {
    setEditingPaymentId(null);
    setEditForm(null);
  };

  const handleEditChange = (field: keyof EditForm, value: string) => {
    setEditForm((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      if (field === "netAmount") {
        const { vatAmount, totalAmount } = calculateVatAndTotal(next.netAmount);
        next.vatAmount = vatAmount;
        next.totalAmount = totalAmount;
      }
      return next;
    });
  };

  const handleEditClientSelection = (clientId: string) => {
    const selectedClient = clients.find((client) => client.id === clientId);
    setEditForm((current) => {
      if (!current || !selectedClient) return current;
      return {
        ...current,
        clientId,
        clientName: selectedClient.name,
        rut: selectedClient.rut ?? "",
        contactName: selectedClient.contactName ?? "",
        email: selectedClient.email ?? "",
      };
    });
  };

  const handleSaveEdit = async () => {
    if (!editingPaymentId || !editForm || !editForm.clientName.trim()) return;

    await updateMutation.mutateAsync({
      id: editingPaymentId,
      data: {
        clientId: editForm.clientId || null,
        clientName: editForm.clientName.trim(),
        rut: editForm.rut.trim() || null,
        contactName: editForm.contactName.trim() || null,
        email: editForm.email.trim() || null,
        serviceItem: editForm.serviceItem.trim() || null,
        serviceMonth: editForm.serviceMonth.trim() || null,
        issueDate: editForm.issueDate || null,
        dueDate: editForm.dueDate || null,
        netAmount: Number.parseFloat(editForm.netAmount || "0"),
        vatAmount: Number.parseFloat(editForm.vatAmount || "0"),
        totalAmount: Number.parseFloat(editForm.totalAmount || "0"),
        status: editForm.status,
        notes: editForm.notes.trim() || null,
      },
    });

    toast({ title: "Ingreso cliente actualizado" });
    cancelEdit();
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <BriefcaseBusiness className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Ingresos Clientes</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Neto total</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{formatCLP(summary.totalNet)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Cobrado</p>
            <p className="text-xl font-semibold tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
              {formatCLP(summary.paid)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Por cobrar</p>
            <p className="text-xl font-semibold tabular-nums mt-1 text-amber-700 dark:text-amber-300">
              {formatCLP(summary.receivable)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Proyectado</p>
            <p className="text-xl font-semibold tabular-nums mt-1 text-blue-700 dark:text-blue-300">
              {formatCLP(summary.projected)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Plus className="size-4" />
            Nuevo ingreso cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Cliente</p>
            <Select value={form.clientId || undefined} onValueChange={handleClientSelection}>
              <SelectTrigger data-testid="select-client-existing">
                <SelectValue placeholder="Seleccionar cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Nombre cliente</p>
            <Input
              placeholder="Cliente"
              value={form.clientName}
              onChange={(e) => handleChange("clientName", e.target.value)}
              data-testid="input-client-name"
              readOnly={Boolean(form.clientId)}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">RUT</p>
            <Input
              placeholder="12.345.678-9"
              value={form.rut}
              onChange={(e) => handleChange("rut", e.target.value)}
              readOnly={Boolean(form.clientId)}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Contacto</p>
            <Input
              placeholder="Contacto"
              value={form.contactName}
              onChange={(e) => handleChange("contactName", e.target.value)}
              readOnly={Boolean(form.clientId)}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Email</p>
            <Input
              placeholder="email@cliente.com"
              value={form.email}
              onChange={(e) => handleChange("email", e.target.value)}
              readOnly={Boolean(form.clientId)}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Servicio</p>
            <Input
              placeholder="Servicio"
              value={form.serviceItem}
              onChange={(e) => handleChange("serviceItem", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Estado</p>
            <Select value={form.status} onValueChange={(value) => handleChange("status", value)}>
              <SelectTrigger data-testid="select-client-payment-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="projected">Proyectado</SelectItem>
                <SelectItem value="receivable">Por cobrar</SelectItem>
                <SelectItem value="paid">Cobrado</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Mes de servicio</p>
            <Input
              placeholder="Mes de servicio"
              value={form.serviceMonth}
              onChange={(e) => handleChange("serviceMonth", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Fecha emisión</p>
            <Input type="date" value={form.issueDate} onChange={(e) => handleChange("issueDate", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Fecha vencimiento</p>
            <Input type="date" value={form.dueDate} onChange={(e) => handleChange("dueDate", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Monto neto</p>
            <Input type="number" placeholder="Monto neto" value={form.netAmount} onChange={(e) => handleChange("netAmount", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">IVA (19% automático)</p>
            <Input type="number" placeholder="IVA (19% automático)" value={form.vatAmount} readOnly />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Monto total</p>
            <Input type="number" placeholder="Monto total" value={form.totalAmount} readOnly />
          </div>
          <div className="xl:col-span-2" />
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending || createClientMutation.isPending}
            data-testid="button-add-client-payment"
          >
            {createMutation.isPending || createClientMutation.isPending ? "Guardando..." : "Guardar ingreso"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Crear cliente nuevo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Si el cliente no existe en la lista, puedes crearlo rápido aquí mismo sin salir de la página.
            </p>
            <Button
              variant={showCreateClientForm ? "secondary" : "outline"}
              onClick={() => setShowCreateClientForm((current) => !current)}
              data-testid="button-toggle-create-client"
            >
              {showCreateClientForm ? "Cerrar" : "Crear cliente nuevo"}
            </Button>
          </div>

          {showCreateClientForm ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Nombre</p>
                <Input
                  placeholder="Nombre cliente"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">RUT</p>
                <Input
                  placeholder="12.345.678-9"
                  value={newClientRut}
                  onChange={(e) => setNewClientRut(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Ámbito</p>
                <Select value={newClientWorkspace} onValueChange={setNewClientWorkspace}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="business">Empresa</SelectItem>
                    <SelectItem value="family">Familia</SelectItem>
                    <SelectItem value="dentist">Consulta Dentista</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleQuickCreateClient}
                  disabled={createClientMutation.isPending}
                  data-testid="button-create-client-inline"
                >
                  {createClientMutation.isPending ? "Creando..." : "Guardar cliente"}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Clientes y pagos</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table data-testid="table-client-payments">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("clientName")}>Cliente{renderSortIcon("clientName")}</button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("rut")}>RUT{renderSortIcon("rut")}</button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("serviceItem")}>Servicio{renderSortIcon("serviceItem")}</button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("serviceMonth")}>Mes{renderSortIcon("serviceMonth")}</button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("issueDate")}>Emisión{renderSortIcon("issueDate")}</button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("dueDate")}>Vencimiento{renderSortIcon("dueDate")}</button>
                  </TableHead>
                  <TableHead>
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("status")}>Estado{renderSortIcon("status")}</button>
                  </TableHead>
                  <TableHead>Notas</TableHead>
                  <TableHead className="text-right">
                    <button type="button" className="inline-flex items-center gap-1 ml-auto" onClick={() => toggleSort("netAmount")}>Neto{renderSortIcon("netAmount")}</button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button type="button" className="inline-flex items-center gap-1 ml-auto" onClick={() => toggleSort("vatAmount")}>IVA{renderSortIcon("vatAmount")}</button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button type="button" className="inline-flex items-center gap-1 ml-auto" onClick={() => toggleSort("totalAmount")}>Total{renderSortIcon("totalAmount")}</button>
                  </TableHead>
                  <TableHead className="text-right pr-5">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPayments.map((payment) => {
                  const isEditing = editingPaymentId === payment.id && editForm;

                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="pl-5 text-sm font-medium">
                        {isEditing ? (
                          <div className="space-y-2 min-w-[220px]">
                            <Select value={editForm.clientId || undefined} onValueChange={handleEditClientSelection}>
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Seleccionar cliente" />
                              </SelectTrigger>
                              <SelectContent>
                                {clients.map((client) => (
                                  <SelectItem key={client.id} value={client.id}>
                                    {client.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              value={editForm.clientName}
                              onChange={(e) => handleEditChange("clientName", e.target.value)}
                              className="h-8"
                            />
                          </div>
                        ) : (
                          payment.clientName
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {isEditing ? (
                          <Input
                            value={editForm.rut}
                            onChange={(e) => handleEditChange("rut", e.target.value)}
                            className="h-8 min-w-[130px]"
                          />
                        ) : (
                          payment.rut ?? "-"
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {isEditing ? (
                          <Input
                            value={editForm.serviceItem}
                            onChange={(e) => handleEditChange("serviceItem", e.target.value)}
                            className="h-8 min-w-[140px]"
                          />
                        ) : (
                          payment.serviceItem ?? "-"
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {isEditing ? (
                          <Input
                            value={editForm.serviceMonth}
                            onChange={(e) => handleEditChange("serviceMonth", e.target.value)}
                            className="h-8 min-w-[110px]"
                          />
                        ) : (
                          payment.serviceMonth ?? "-"
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {isEditing ? (
                          <Input
                            type="date"
                            value={editForm.issueDate}
                            onChange={(e) => handleEditChange("issueDate", e.target.value)}
                            className="h-8 min-w-[150px]"
                          />
                        ) : (
                          payment.issueDate ?? "-"
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {isEditing ? (
                          <Input
                            type="date"
                            value={editForm.dueDate}
                            onChange={(e) => handleEditChange("dueDate", e.target.value)}
                            className="h-8 min-w-[150px]"
                          />
                        ) : (
                          payment.dueDate ?? "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Select value={editForm.status} onValueChange={(value) => handleEditChange("status", value)}>
                            <SelectTrigger className="w-36 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="projected">Proyectado</SelectItem>
                              <SelectItem value="receivable">Por cobrar</SelectItem>
                              <SelectItem value="paid">Cobrado</SelectItem>
                              <SelectItem value="cancelled">Cancelado</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Select
                            value={payment.status}
                            onValueChange={(value) => handleStatusChange(payment.id, value as PaymentStatus)}
                          >
                            <SelectTrigger className="w-36 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="projected">Proyectado</SelectItem>
                              <SelectItem value="receivable">Por cobrar</SelectItem>
                              <SelectItem value="paid">Cobrado</SelectItem>
                              <SelectItem value="cancelled">Cancelado</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {isEditing ? (
                          <Input
                            value={editForm.notes}
                            onChange={(e) => handleEditChange("notes", e.target.value)}
                            className="h-8 min-w-[160px]"
                          />
                        ) : (
                          payment.notes ?? "-"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {isEditing ? (
                          <Input
                            type="number"
                            value={editForm.netAmount}
                            onChange={(e) => handleEditChange("netAmount", e.target.value)}
                            className="h-8 w-28 ml-auto text-right"
                          />
                        ) : (
                          formatCLP(payment.netAmount)
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {isEditing ? formatCLP(Number(editForm.vatAmount || 0)) : formatCLP(payment.vatAmount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {isEditing ? formatCLP(Number(editForm.totalAmount || 0)) : formatCLP(payment.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right pr-5">
                        <div className="flex items-center justify-end gap-2">
                          {isEditing ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={handleSaveEdit}
                                disabled={updateMutation.isPending}
                              >
                                <Check className="size-3.5 text-emerald-500" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={cancelEdit}
                              >
                                <X className="size-3.5 text-muted-foreground" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Badge variant={
                                payment.status === "paid" ? "secondary" : payment.status === "projected" ? "outline" : "outline"
                              }>
                                {payment.status === "paid" ? "Cobrado" : payment.status === "receivable" ? "Por cobrar" : payment.status === "projected" ? "Proyectado" : "Cancelado"}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => startEdit(payment)}
                              >
                                <Pencil className="size-3.5 text-muted-foreground" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                  >
                                    <Trash2 className="size-3.5 text-muted-foreground" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>¿Eliminar este elemento?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Se eliminará el ingreso cliente de "{payment.clientName}" y ya no aparecerá en la tabla.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() =>
                                        deleteMutation.mutate(payment.id, {
                                          onSuccess: () => toast({ title: "Ingreso cliente eliminado" }),
                                        })
                                      }
                                    >
                                      Eliminar
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell colSpan={8} className="pl-5">Total</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.totalNet)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.totalVat)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCLP(summary.totalGross)}</TableCell>
                  <TableCell className="pr-5" />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
