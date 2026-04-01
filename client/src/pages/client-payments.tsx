import { useMemo, useState } from "react";
import type { Account, ClientPayment } from "@shared/schema";
import {
  useClientPayments,
  useClients,
  useAccounts,
  useCreateClient,
  useCreateClientPayment,
  useDeleteClientPayment,
  useMigrateClientPaymentStatuses,
  useRegularizeClientPayments,
  useSyncClientPaymentSettlement,
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { BriefcaseBusiness, Check, Pencil, Plus, Trash2, X, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

type PaymentStatus = "projected" | "receivable" | "invoiced" | "paid" | "cancelled";

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

type MarkPaidContext =
  | {
      mode: "create";
      formData: typeof defaultForm;
    }
  | {
      mode: "update";
      payment: ClientPayment;
      updatedFields: Partial<ClientPayment>;
    };

type MarkPaidDraft = {
  netAmount: string;
  paymentDate: string;
  accountId: string;
  context: MarkPaidContext;
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

function getMonthKeyFromDate(date: string | null | undefined) {
  return date ? date.slice(0, 7) : "";
}

function formatMonthKeyLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const label = new Intl.DateTimeFormat("es-CL", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function findDefaultSantanderOmAccount(accounts: Account[]) {
  return (
    accounts.find((account) => {
      const name = normalizeText(account.name);
      return (
        (account.type === "checking" || account.type === "savings") &&
        name.includes("santander om")
      );
    }) ?? null
  );
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
  const [markPaidDraft, setMarkPaidDraft] = useState<MarkPaidDraft | null>(null);
  const [showCreateClientForm, setShowCreateClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientRut, setNewClientRut] = useState("");
  const [newClientWorkspace, setNewClientWorkspace] = useState("business");
  const [selectedMonthFilter, setSelectedMonthFilter] = useState("all");
  const [sortField, setSortField] = useState<"clientName" | "rut" | "serviceItem" | "serviceMonth" | "issueDate" | "dueDate" | "status" | "netAmount" | "vatAmount" | "totalAmount">("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const { toast } = useToast();

  const { data: clients = [] } = useClients();
  const { data: accounts = [] } = useAccounts();
  const { data: payments = [], isLoading } = useClientPayments();
  const createClientMutation = useCreateClient();
  const createMutation = useCreateClientPayment();
  const updateMutation = useUpdateClientPayment();
  const syncSettlementMutation = useSyncClientPaymentSettlement();
  const deleteMutation = useDeleteClientPayment();
  const migrateStatusesMutation = useMigrateClientPaymentStatuses();
  const regularizeClientPaymentsMutation = useRegularizeClientPayments();

  const activeBankAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        const isBankType = account.type === "checking" || account.type === "savings";
        const isActive = (account as Account & { isActive?: boolean }).isActive ?? true;
        return isBankType && isActive;
      }),
    [accounts],
  );
  const defaultSantanderOmAccount = useMemo(
    () => findDefaultSantanderOmAccount(activeBankAccounts),
    [activeBankAccounts],
  );
  const hasLegacyStatuses = useMemo(
    () =>
      payments.some((payment) => {
        const normalizedStatus = normalizeText(payment.status);
        return normalizedStatus === "cobrado";
      }),
    [payments],
  );

  const monthOptions = useMemo(
    () =>
      Array.from(
        new Set(
          payments
            .map((payment) => getMonthKeyFromDate(payment.dueDate))
            .filter((monthKey) => Boolean(monthKey)),
        ),
      )
        .sort((left, right) => right.localeCompare(left))
        .map((monthKey) => ({
          value: monthKey,
          label: formatMonthKeyLabel(monthKey),
        })),
    [payments],
  );

  const filteredPayments = useMemo(
    () =>
      selectedMonthFilter === "all"
        ? payments
        : payments.filter((payment) => getMonthKeyFromDate(payment.dueDate) === selectedMonthFilter),
    [payments, selectedMonthFilter],
  );

  const summary = useMemo(() => filteredPayments.reduce((acc, payment) => {
    if (payment.status === "cancelled") return acc;

    acc.totalNet += payment.netAmount;
    acc.totalVat += payment.vatAmount;
    acc.totalGross += payment.totalAmount;

    if (payment.status === "paid") acc.paid += payment.netAmount;
    if (payment.status === "invoiced") acc.invoiced += payment.netAmount;
    if (payment.status === "receivable") acc.receivable += payment.netAmount;
    if (payment.status === "projected") acc.projected += payment.netAmount;

    return acc;
  }, {
    totalNet: 0,
    totalVat: 0,
    totalGross: 0,
    paid: 0,
    invoiced: 0,
    receivable: 0,
    projected: 0,
  }), [filteredPayments]);

  const sortedPayments = useMemo(
    () =>
      [...filteredPayments].sort((left, right) => {
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
    [filteredPayments, sortDirection, sortField],
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

    if (form.status === "paid") {
      setMarkPaidDraft({
        netAmount: form.netAmount || "0",
        paymentDate: new Date().toISOString().slice(0, 10),
        accountId: defaultSantanderOmAccount?.id ?? activeBankAccounts[0]?.id ?? "",
        context: {
          mode: "create",
          formData: {
            ...form,
            clientId: resolvedClientId ?? "",
          },
        },
      });
      return;
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
      expectedDate: form.dueDate || null,
      paymentDate: null,
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

  const syncSettlementForPayment = async (payment: ClientPayment, accountId?: string | null) => {
    await syncSettlementMutation.mutateAsync({ payment, accountId });
  };

  const handleStatusChange = async (payment: ClientPayment, status: PaymentStatus) => {
    if (status === "paid" && payment.status !== "paid") {
      setMarkPaidDraft({
        netAmount: String(payment.netAmount ?? 0),
        paymentDate: new Date().toISOString().slice(0, 10),
        accountId: defaultSantanderOmAccount?.id ?? activeBankAccounts[0]?.id ?? "",
        context: {
          mode: "update",
          payment,
          updatedFields: {},
        },
      });
      return;
    }

    await updateMutation.mutateAsync({
      id: payment.id,
      data: {
        status,
        paymentDate: status === "paid" ? payment.paymentDate ?? new Date().toISOString().slice(0, 10) : null,
      },
    });

    if (payment.status === "paid" || status === "paid") {
      await syncSettlementForPayment({
        ...payment,
        status,
        paymentDate: status === "paid" ? payment.paymentDate ?? new Date().toISOString().slice(0, 10) : null,
      });
    }
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

    const existingPayment = payments.find((payment) => payment.id === editingPaymentId);
    if (editForm.status === "paid" && existingPayment && existingPayment.status !== "paid") {
      setMarkPaidDraft({
        netAmount: editForm.netAmount || "0",
        paymentDate: new Date().toISOString().slice(0, 10),
        accountId: defaultSantanderOmAccount?.id ?? activeBankAccounts[0]?.id ?? "",
        context: {
          mode: "update",
          payment: existingPayment,
          updatedFields: {
            clientId: editForm.clientId || null,
            clientName: editForm.clientName.trim(),
            rut: editForm.rut.trim() || null,
            contactName: editForm.contactName.trim() || null,
            email: editForm.email.trim() || null,
            serviceItem: editForm.serviceItem.trim() || null,
            serviceMonth: editForm.serviceMonth.trim() || null,
            issueDate: editForm.issueDate || null,
            dueDate: editForm.dueDate || null,
            expectedDate: editForm.dueDate || null,
            notes: editForm.notes.trim() || null,
          },
        },
      });
      return;
    }

    const updatedPayment: ClientPayment = {
      ...(existingPayment as ClientPayment),
      id: editingPaymentId,
      clientId: editForm.clientId || null,
      clientName: editForm.clientName.trim(),
      rut: editForm.rut.trim() || null,
      contactName: editForm.contactName.trim() || null,
      email: editForm.email.trim() || null,
      accountManager: existingPayment?.accountManager ?? null,
      serviceItem: editForm.serviceItem.trim() || null,
      serviceMonth: editForm.serviceMonth.trim() || null,
      issueDate: editForm.issueDate || null,
      dueDate: editForm.dueDate || null,
      expectedDate: editForm.dueDate || null,
      paymentDate: editForm.status === "paid" ? new Date().toISOString().slice(0, 10) : null,
      netAmount: Number.parseFloat(editForm.netAmount || "0"),
      vatAmount: Number.parseFloat(editForm.vatAmount || "0"),
      totalAmount: Number.parseFloat(editForm.totalAmount || "0"),
      status: editForm.status,
      notes: editForm.notes.trim() || null,
      workspace: existingPayment?.workspace ?? "business",
    };

    await updateMutation.mutateAsync({
      id: editingPaymentId,
      data: {
        clientId: updatedPayment.clientId,
        clientName: updatedPayment.clientName,
        rut: updatedPayment.rut,
        contactName: updatedPayment.contactName,
        email: updatedPayment.email,
        serviceItem: updatedPayment.serviceItem,
        serviceMonth: updatedPayment.serviceMonth,
        issueDate: updatedPayment.issueDate,
        dueDate: updatedPayment.dueDate,
        expectedDate: updatedPayment.expectedDate,
        netAmount: updatedPayment.netAmount,
        vatAmount: updatedPayment.vatAmount,
        totalAmount: updatedPayment.totalAmount,
        status: updatedPayment.status,
        paymentDate: updatedPayment.paymentDate,
        notes: updatedPayment.notes,
      },
    });

    if (existingPayment?.status === "paid" || updatedPayment.status === "paid") {
      await syncSettlementForPayment(updatedPayment);
    }

    toast({ title: "Ingreso cliente actualizado" });
    cancelEdit();
  };

  const handleConfirmMarkPaid = async () => {
    if (!markPaidDraft) return;

    const netAmount = Number.parseFloat(markPaidDraft.netAmount || "0");
    const safeNetAmount = Number.isFinite(netAmount) ? netAmount : 0;
    const { vatAmount, totalAmount } = calculateVatAndTotal(String(safeNetAmount));

    if (!markPaidDraft.accountId) {
      toast({
        title: "Falta la cuenta destino",
        description: "Selecciona la cuenta donde entró el pago del cliente.",
        variant: "destructive",
      });
      return;
    }

    if (markPaidDraft.context.mode === "create") {
      const sourceForm = markPaidDraft.context.formData;
      const createdPayment = await createMutation.mutateAsync({
        clientId: sourceForm.clientId || null,
        clientName: sourceForm.clientName.trim(),
        rut: sourceForm.rut.trim() || null,
        contactName: sourceForm.contactName.trim() || null,
        email: sourceForm.email.trim() || null,
        accountManager: null,
        serviceItem: sourceForm.serviceItem || null,
        serviceMonth: sourceForm.serviceMonth || null,
        issueDate: sourceForm.issueDate || null,
        dueDate: sourceForm.dueDate || null,
        expectedDate: sourceForm.dueDate || null,
        paymentDate: markPaidDraft.paymentDate,
        netAmount: safeNetAmount,
        vatAmount: Number.parseFloat(vatAmount),
        totalAmount: Number.parseFloat(totalAmount),
        status: "paid",
        notes: null,
        workspace: "business",
      });

      const settledCreatedPayment: ClientPayment = {
        ...(createdPayment as ClientPayment),
        paymentDate: markPaidDraft.paymentDate,
        netAmount: safeNetAmount,
        vatAmount: Number.parseFloat(vatAmount),
        totalAmount: Number.parseFloat(totalAmount),
        status: "paid",
      };

      await syncSettlementForPayment(settledCreatedPayment, markPaidDraft.accountId);

      toast({ title: "Pago de cliente registrado" });
      setForm(defaultForm);
      setMarkPaidDraft(null);
      return;
    }

    const { payment, updatedFields } = markPaidDraft.context;
    const updatedClientName = String(updatedFields.clientName ?? payment.clientName).trim();

    await updateMutation.mutateAsync({
      id: payment.id,
      data: {
        ...updatedFields,
        netAmount: safeNetAmount,
        vatAmount: Number.parseFloat(vatAmount),
        totalAmount: Number.parseFloat(totalAmount),
        status: "paid",
        paymentDate: markPaidDraft.paymentDate,
      },
    });

    await syncSettlementForPayment({
      ...payment,
      ...updatedFields,
      clientName: updatedClientName,
      netAmount: safeNetAmount,
      vatAmount: Number.parseFloat(vatAmount),
      totalAmount: Number.parseFloat(totalAmount),
      status: "paid",
      paymentDate: markPaidDraft.paymentDate,
    }, markPaidDraft.accountId);

    toast({ title: "Pago de cliente registrado" });
    cancelEdit();
    setMarkPaidDraft(null);
  };

  const handleDeletePayment = async (payment: ClientPayment) => {
    await deleteMutation.mutateAsync(payment.id);
    toast({ title: "Ingreso cliente eliminado" });
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BriefcaseBusiness className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">Ingresos Clientes</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() =>
              regularizeClientPaymentsMutation.mutate(undefined, {
                onSuccess: (result) =>
                  toast({
                    title: "ClientPayment regularizados",
                    description:
                      `${result.updatedPayments} pagos actualizados, ` +
                      `${result.linkedByIdentity} vínculos con cliente recuperados y ` +
                      `${result.updatedSettlements + result.deletedSettlements} ajustes en transacciones.`,
                  }),
              })
            }
            disabled={regularizeClientPaymentsMutation.isPending}
          >
            {regularizeClientPaymentsMutation.isPending ? "Regularizando..." : "Regularizar vínculos"}
          </Button>
          {hasLegacyStatuses ? (
            <Button
              variant="outline"
              onClick={() =>
                migrateStatusesMutation.mutate(undefined, {
                  onSuccess: ({ updated }) =>
                    toast({
                      title: "Estados históricos migrados",
                      description: `${updated} registros pasaron a Facturado.`,
                    }),
                })
              }
              disabled={migrateStatusesMutation.isPending}
            >
              {migrateStatusesMutation.isPending ? "Migrando..." : "Migrar estados históricos"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Neto total</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{formatCLP(summary.totalNet)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Pagado</p>
            <p className="text-xl font-semibold tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
              {formatCLP(summary.paid)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Facturado</p>
            <p className="text-xl font-semibold tabular-nums mt-1 text-violet-700 dark:text-violet-300">
              {formatCLP(summary.invoiced)}
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
                <SelectItem value="invoiced">Facturado</SelectItem>
                <SelectItem value="paid">Pagado</SelectItem>
                <SelectItem value="cancelled">Anulado</SelectItem>
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
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-base font-semibold">Clientes y pagos</CardTitle>
            <div className="w-full md:w-64 space-y-1.5">
              <p className="text-xs text-muted-foreground">Mes</p>
              <Select value={selectedMonthFilter} onValueChange={setSelectedMonthFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los meses</SelectItem>
                  {monthOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
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
                                <SelectItem value="invoiced">Facturado</SelectItem>
                                <SelectItem value="paid">Pagado</SelectItem>
                                <SelectItem value="cancelled">Anulado</SelectItem>
                              </SelectContent>
                            </Select>
                        ) : (
                          <Select
                            value={payment.status}
                            onValueChange={(value) => handleStatusChange(payment, value as PaymentStatus)}
                          >
                            <SelectTrigger className="w-36 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="projected">Proyectado</SelectItem>
                              <SelectItem value="receivable">Por cobrar</SelectItem>
                              <SelectItem value="invoiced">Facturado</SelectItem>
                              <SelectItem value="paid">Pagado</SelectItem>
                              <SelectItem value="cancelled">Anulado</SelectItem>
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
                                payment.status === "paid" ? "secondary" : payment.status === "invoiced" ? "default" : "outline"
                              }>
                                {payment.status === "paid"
                                  ? "Pagado"
                                  : payment.status === "invoiced"
                                    ? "Facturado"
                                    : payment.status === "receivable"
                                      ? "Por cobrar"
                                      : payment.status === "projected"
                                        ? "Proyectado"
                                        : "Anulado"}
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
                                      onClick={() => {
                                        void handleDeletePayment(payment);
                                      }}
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

      <Dialog open={Boolean(markPaidDraft)} onOpenChange={(open) => !open && setMarkPaidDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar cliente como pagado</DialogTitle>
            <DialogDescription>
              Confirma el monto que entró y la cuenta destino donde se recibió el pago.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Monto neto</p>
              <Input
                type="number"
                value={markPaidDraft?.netAmount ?? ""}
                onChange={(e) =>
                  setMarkPaidDraft((current) => (current ? { ...current, netAmount: e.target.value } : current))
                }
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">IVA (19%)</p>
              <Input
                value={formatCLP(Number(calculateVatAndTotal(markPaidDraft?.netAmount ?? "0").vatAmount))}
                readOnly
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Total</p>
              <Input
                value={formatCLP(Number(calculateVatAndTotal(markPaidDraft?.netAmount ?? "0").totalAmount))}
                readOnly
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Fecha de pago</p>
              <Input
                type="date"
                value={markPaidDraft?.paymentDate ?? ""}
                onChange={(e) =>
                  setMarkPaidDraft((current) => (current ? { ...current, paymentDate: e.target.value } : current))
                }
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Cuenta destino</p>
              <Select
                value={markPaidDraft?.accountId ?? ""}
                onValueChange={(value) =>
                  setMarkPaidDraft((current) => (current ? { ...current, accountId: value } : current))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cuenta" />
                </SelectTrigger>
                <SelectContent>
                  {activeBankAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} — {account.bank}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidDraft(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmMarkPaid}
              disabled={createMutation.isPending || updateMutation.isPending || syncSettlementMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending || syncSettlementMutation.isPending ? "Guardando..." : "Confirmar pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
