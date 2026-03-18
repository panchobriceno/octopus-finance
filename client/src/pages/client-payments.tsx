import { useMemo, useState } from "react";
import {
  useClientPayments,
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
import { useToast } from "@/hooks/use-toast";
import { BriefcaseBusiness, Plus, Trash2 } from "lucide-react";

type PaymentStatus = "projected" | "receivable" | "paid" | "cancelled";

const defaultForm = {
  clientName: "",
  serviceItem: "",
  serviceMonth: "",
  dueDate: "",
  paymentDate: "",
  netAmount: "",
  vatAmount: "",
  totalAmount: "",
  status: "receivable" as PaymentStatus,
};

export default function ClientPaymentsPage() {
  const [form, setForm] = useState(defaultForm);
  const { toast } = useToast();

  const { data: payments = [], isLoading } = useClientPayments();
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

  const handleChange = (field: keyof typeof defaultForm, value: string) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      const net = Number.parseFloat(next.netAmount || "0");
      const vat = Number.parseFloat(next.vatAmount || "0");
      const total = Number.parseFloat(next.totalAmount || "0");

      if (field === "netAmount" || field === "vatAmount") {
        next.totalAmount = String((Number.isFinite(net) ? net : 0) + (Number.isFinite(vat) ? vat : 0));
      } else if (field === "totalAmount" && next.vatAmount === "") {
        next.vatAmount = "0";
        next.netAmount = String(Number.isFinite(total) ? total : 0);
      }

      return next;
    });
  };

  const handleCreate = () => {
    if (!form.clientName.trim() || !form.netAmount) return;

    createMutation.mutate({
      clientName: form.clientName.trim(),
      rut: null,
      contactName: null,
      email: null,
      accountManager: null,
      serviceItem: form.serviceItem || null,
      serviceMonth: form.serviceMonth || null,
      issueDate: null,
      dueDate: form.dueDate || null,
      paymentDate: form.paymentDate || null,
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

  const handleStatusChange = (id: string, status: PaymentStatus) => {
    updateMutation.mutate({
      id,
      data: {
        status,
        paymentDate: status === "paid" ? new Date().toISOString().slice(0, 10) : null,
      },
    });
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
          <Input
            placeholder="Cliente"
            value={form.clientName}
            onChange={(e) => handleChange("clientName", e.target.value)}
            data-testid="input-client-name"
          />
          <Input
            placeholder="Servicio"
            value={form.serviceItem}
            onChange={(e) => handleChange("serviceItem", e.target.value)}
          />
          <Input
            placeholder="Mes de servicio"
            value={form.serviceMonth}
            onChange={(e) => handleChange("serviceMonth", e.target.value)}
          />
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
          <Input type="date" value={form.dueDate} onChange={(e) => handleChange("dueDate", e.target.value)} />
          <Input type="date" value={form.paymentDate} onChange={(e) => handleChange("paymentDate", e.target.value)} />
          <Input type="number" placeholder="Monto neto" value={form.netAmount} onChange={(e) => handleChange("netAmount", e.target.value)} />
          <Input type="number" placeholder="IVA" value={form.vatAmount} onChange={(e) => handleChange("vatAmount", e.target.value)} />
          <Input type="number" placeholder="Monto total" value={form.totalAmount} onChange={(e) => handleChange("totalAmount", e.target.value)} />
          <div className="xl:col-span-3" />
          <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-add-client-payment">
            {createMutation.isPending ? "Guardando..." : "Guardar ingreso"}
          </Button>
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
                  <TableHead className="pl-5">Cliente</TableHead>
                  <TableHead>Servicio</TableHead>
                  <TableHead>Mes</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right pr-5">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="pl-5 text-sm font-medium">{payment.clientName}</TableCell>
                    <TableCell className="text-sm">{payment.serviceItem ?? "-"}</TableCell>
                    <TableCell className="text-sm">{payment.serviceMonth ?? "-"}</TableCell>
                    <TableCell className="text-sm">{payment.dueDate ?? "-"}</TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{formatCLP(payment.netAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{formatCLP(payment.vatAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">{formatCLP(payment.totalAmount)}</TableCell>
                    <TableCell className="text-right pr-5">
                      <div className="flex items-center justify-end gap-2">
                        <Badge variant={
                          payment.status === "paid" ? "secondary" : payment.status === "projected" ? "outline" : "outline"
                        }>
                          {payment.status === "paid" ? "Cobrado" : payment.status === "receivable" ? "Por cobrar" : payment.status === "projected" ? "Proyectado" : "Cancelado"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => deleteMutation.mutate(payment.id)}
                        >
                          <Trash2 className="size-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
