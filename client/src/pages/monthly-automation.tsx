import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Play, RotateCw, Trash2, XCircle } from "lucide-react";
import type { CommitmentInstance, CommitmentTemplate, Transaction } from "@shared/schema";
import {
  useAccounts,
  useBootstrapCommitmentTemplates,
  useCategories,
  useCommitmentInstances,
  useCommitmentTemplates,
  useCreateCommitmentTemplate,
  useDeleteCommitmentTemplate,
  useGenerateCommitmentInstances,
  useReconcileCommitmentInstances,
  useTransactions,
  useUpdateCommitmentInstance,
  useUpdateCommitmentTemplate,
} from "@/lib/hooks";
import { buildCommitmentDashboard, getCurrentMonthKey } from "@/domain/commitments";
import { formatCLP } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type TemplateForm = {
  name: string;
  category: string;
  amount: string;
  amountMode: "fixed" | "variable";
  workspace: "business" | "family" | "dentist" | "shared";
  movementType: "expense" | "credit_card_payment" | "transfer";
  paymentMethod: "bank_account" | "credit_card" | "cash";
  accountId: string;
  creditCardName: string;
  dayOfMonth: string;
  matchingKeywords: string;
  amountTolerance: string;
  dateToleranceDays: string;
  notes: string;
};

const defaultForm: TemplateForm = {
  name: "",
  category: "",
  amount: "",
  amountMode: "fixed",
  workspace: "family",
  movementType: "expense",
  paymentMethod: "bank_account",
  accountId: "none",
  creditCardName: "",
  dayOfMonth: "5",
  matchingKeywords: "",
  amountTolerance: "1000",
  dateToleranceDays: "5",
  notes: "",
};

const WORKSPACE_LABELS: Record<string, string> = {
  business: "Empresa",
  family: "Familia",
  dentist: "Consulta",
  shared: "Compartido",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  paid: "Pagado",
  skipped: "Omitido",
};

function addMonths(monthKey: string, offset: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseKeywords(value: string) {
  return value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function getStatusTone(instance: CommitmentInstance) {
  if (instance.status === "paid") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (instance.status === "skipped") return "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300";
  if (instance.dueDate < new Date().toISOString().slice(0, 10)) return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
}

function transactionLabel(transaction: Transaction | null) {
  if (!transaction) return "Sin movimiento";
  return `${transaction.date} · ${transaction.name}`;
}

export default function MonthlyAutomationPage() {
  const { toast } = useToast();
  const currentMonthKey = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [form, setForm] = useState<TemplateForm>(defaultForm);

  const { data: templates = [], isLoading: templatesLoading } = useCommitmentTemplates();
  const { data: instances = [], isLoading: instancesLoading } = useCommitmentInstances();
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();

  const createTemplateMutation = useCreateCommitmentTemplate();
  const updateTemplateMutation = useUpdateCommitmentTemplate();
  const deleteTemplateMutation = useDeleteCommitmentTemplate();
  const generateMutation = useGenerateCommitmentInstances();
  const reconcileMutation = useReconcileCommitmentInstances();
  const bootstrapTemplatesMutation = useBootstrapCommitmentTemplates();
  const updateInstanceMutation = useUpdateCommitmentInstance();

  const monthOptions = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addMonths(currentMonthKey, index - 3)),
    [currentMonthKey],
  );
  const monthInstances = useMemo(
    () => instances.filter((instance) => instance.monthKey === selectedMonth),
    [instances, selectedMonth],
  );
  const dashboard = useMemo(
    () => buildCommitmentDashboard(monthInstances),
    [monthInstances],
  );
  const transactionById = useMemo(
    () => new Map(transactions.map((transaction) => [transaction.id, transaction])),
    [transactions],
  );
  const expenseCategories = useMemo(
    () =>
      Array.from(
        new Set(
          categories
            .filter((category) => category.type === "expense")
            .map((category) => category.name),
        ),
      ).sort((left, right) => left.localeCompare(right, "es")),
    [categories],
  );
  const cashAccounts = useMemo(
    () => accounts.filter((account) => account.type === "checking" || account.type === "savings"),
    [accounts],
  );
  const cardNames = useMemo(
    () =>
      Array.from(
        new Set(
          transactions
            .map((transaction) => transaction.creditCardName)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((left, right) => left.localeCompare(right, "es")),
    [transactions],
  );

  const updateForm = <Key extends keyof TemplateForm>(key: Key, value: TemplateForm[Key]) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "movementType" && value === "credit_card_payment") {
        next.paymentMethod = "bank_account";
        next.category = next.category || "Pago tarjeta";
      }
      if (key === "paymentMethod" && value !== "credit_card") {
        next.creditCardName = "";
      }
      return next;
    });
  };

  const handleCreateTemplate = async () => {
    const amount = Number(form.amount || 0);
    const dayOfMonth = Number(form.dayOfMonth || 1);
    const amountTolerance = Number(form.amountTolerance || 0);
    const dateToleranceDays = Number(form.dateToleranceDays || 0);

    if (!form.name.trim() || !form.category.trim() || !Number.isFinite(amount) || amount < 0) {
      toast({
        title: "Faltan datos",
        description: "Completa nombre, categoria y monto.",
        variant: "destructive",
      });
      return;
    }

    await createTemplateMutation.mutateAsync({
      name: form.name.trim(),
      category: form.category.trim(),
      amount,
      amountMode: form.amountMode,
      workspace: form.workspace,
      movementType: form.movementType,
      paymentMethod: form.paymentMethod,
      accountId: form.accountId === "none" ? null : form.accountId,
      destinationAccountId: null,
      creditCardName: form.creditCardName.trim() || null,
      dayOfMonth: Math.max(1, Math.min(31, dayOfMonth)),
      frequency: "monthly",
      matchingKeywords: parseKeywords(form.matchingKeywords),
      amountTolerance: Number.isFinite(amountTolerance) ? amountTolerance : 1000,
      dateToleranceDays: Number.isFinite(dateToleranceDays) ? dateToleranceDays : 5,
      isActive: true,
      notes: form.notes.trim() || null,
    });

    setForm(defaultForm);
    toast({ title: "Compromiso recurrente creado" });
  };

  const handleGenerate = () => {
    generateMutation.mutate(selectedMonth, {
      onSuccess: (result) => {
        toast({
          title: "Compromisos generados",
          description: `${result.created} creados, ${result.skipped} ya existian.`,
        });
      },
    });
  };

  const handleReconcile = () => {
    reconcileMutation.mutate(selectedMonth, {
      onSuccess: (result) => {
        toast({
          title: "Conciliacion terminada",
          description: `${result.matched} compromiso(s) calzaron con movimientos reales.`,
        });
      },
    });
  };

  const handleBootstrapTemplates = () => {
    bootstrapTemplatesMutation.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: "Plantillas creadas",
          description: `${result.created} nuevas desde ${result.scanned} presupuestos recurrentes.`,
        });
      },
    });
  };

  const setInstanceStatus = async (instance: CommitmentInstance, status: "pending" | "paid" | "skipped") => {
    await updateInstanceMutation.mutateAsync({
      id: instance.id,
      data: {
        status,
        paidAt: status === "paid" ? instance.paidAt ?? new Date().toISOString().slice(0, 10) : null,
      },
    });
  };

  const isLoading = templatesLoading || instancesLoading;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <CalendarClock className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">Automatizacion mensual</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((monthKey) => (
                  <SelectItem key={monthKey} value={monthKey}>
                    {monthKey}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={handleGenerate} disabled={generateMutation.isPending}>
              <Play className="size-4" />
              {generateMutation.isPending ? "Generando" : "Generar mes"}
            </Button>
            <Button
              variant="outline"
              onClick={handleBootstrapTemplates}
              disabled={bootstrapTemplatesMutation.isPending}
            >
              <CalendarClock className="size-4" />
              {bootstrapTemplatesMutation.isPending ? "Creando" : "Desde presupuesto"}
            </Button>
            <Button onClick={handleReconcile} disabled={reconcileMutation.isPending}>
              <RotateCw className="size-4" />
              {reconcileMutation.isPending ? "Conciliando" : "Conciliar"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Compromisos</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{dashboard.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Pagados</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-300">{dashboard.paid}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Pendientes</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">{dashboard.pending}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Vencidos</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-red-600 dark:text-red-300">{dashboard.overdue}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Cobertura</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{dashboard.coveragePct}%</p>
              <Progress value={dashboard.coveragePct} className="mt-3 h-2" />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Salida esperada</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCLP(dashboard.expectedOutflow)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Ya pagado</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-300">{formatCLP(dashboard.paidOutflow)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Por salir</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">{formatCLP(dashboard.pendingOutflow)}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Nuevo compromiso recurrente</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-1.5 xl:col-span-2">
              <Label>Nombre</Label>
              <Input value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="Ej: Seguro auto" />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={form.category || undefined} onValueChange={(value) => updateForm("category", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {expenseCategories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Monto</Label>
              <Input type="number" min="0" value={form.amount} onChange={(event) => updateForm("amount", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Modo</Label>
              <Select value={form.amountMode} onValueChange={(value) => updateForm("amountMode", value as TemplateForm["amountMode"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fijo</SelectItem>
                  <SelectItem value="variable">Variable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Dia</Label>
              <Input type="number" min="1" max="31" value={form.dayOfMonth} onChange={(event) => updateForm("dayOfMonth", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Ambito</Label>
              <Select value={form.workspace} onValueChange={(value) => updateForm("workspace", value as TemplateForm["workspace"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Empresa</SelectItem>
                  <SelectItem value="family">Familia</SelectItem>
                  <SelectItem value="shared">Compartido</SelectItem>
                  <SelectItem value="dentist">Consulta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Movimiento</Label>
              <Select value={form.movementType} onValueChange={(value) => updateForm("movementType", value as TemplateForm["movementType"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Gasto</SelectItem>
                  <SelectItem value="credit_card_payment">Pago TC</SelectItem>
                  <SelectItem value="transfer">Transferencia</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Metodo</Label>
              <Select value={form.paymentMethod} onValueChange={(value) => updateForm("paymentMethod", value as TemplateForm["paymentMethod"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_account">Cuenta</SelectItem>
                  <SelectItem value="credit_card">Tarjeta</SelectItem>
                  <SelectItem value="cash">Efectivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 xl:col-span-2">
              <Label>Cuenta esperada</Label>
              <Select value={form.accountId} onValueChange={(value) => updateForm("accountId", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cuenta fija</SelectItem>
                  {cashAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} - {account.bank}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tarjeta</Label>
              <Select value={form.creditCardName || "none"} onValueChange={(value) => updateForm("creditCardName", value === "none" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin tarjeta</SelectItem>
                  {cardNames.map((cardName) => (
                    <SelectItem key={cardName} value={cardName}>
                      {cardName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tolerancia $</Label>
              <Input type="number" min="0" value={form.amountTolerance} onChange={(event) => updateForm("amountTolerance", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Tolerancia dias</Label>
              <Input type="number" min="0" value={form.dateToleranceDays} onChange={(event) => updateForm("dateToleranceDays", event.target.value)} />
            </div>
            <div className="space-y-1.5 xl:col-span-3">
              <Label>Keywords</Label>
              <Input value={form.matchingKeywords} onChange={(event) => updateForm("matchingKeywords", event.target.value)} placeholder="seguro, bci, poliza" />
            </div>
            <div className="space-y-1.5 xl:col-span-3">
              <Label>Notas</Label>
              <Textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} className="min-h-10" />
            </div>
            <div className="md:col-span-2 xl:col-span-6">
              <Button onClick={handleCreateTemplate} disabled={createTemplateMutation.isPending}>
                {createTemplateMutation.isPending ? "Guardando" : "Crear compromiso"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Compromisos del mes</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Fecha</TableHead>
                      <TableHead>Compromiso</TableHead>
                      <TableHead>Ambito</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Movimiento</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="text-right pr-5">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                          Cargando
                        </TableCell>
                      </TableRow>
                    ) : monthInstances.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                          Sin compromisos para {selectedMonth}
                        </TableCell>
                      </TableRow>
                    ) : (
                      monthInstances.map((instance) => {
                        const matchedTransaction = instance.matchedTransactionId
                          ? transactionById.get(instance.matchedTransactionId) ?? null
                          : null;
                        return (
                          <TableRow key={instance.id}>
                            <TableCell className="pl-5 tabular-nums text-sm">{instance.dueDate}</TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <p className="text-sm font-medium">{instance.name}</p>
                                <p className="text-xs text-muted-foreground">{instance.category}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {WORKSPACE_LABELS[instance.workspace] ?? instance.workspace}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs ${getStatusTone(instance)}`}>
                                {STATUS_LABELS[instance.status] ?? instance.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground">
                              {transactionLabel(matchedTransaction)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm font-medium">
                              {formatCLP(instance.expectedAmount)}
                            </TableCell>
                            <TableCell className="pr-5">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  onClick={() => setInstanceStatus(instance, "paid")}
                                  disabled={updateInstanceMutation.isPending}
                                >
                                  <CheckCircle2 className="size-4 text-emerald-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  onClick={() => setInstanceStatus(instance, "skipped")}
                                  disabled={updateInstanceMutation.isPending}
                                >
                                  <XCircle className="size-4 text-muted-foreground" />
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Plantillas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {templates.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Sin plantillas recurrentes
                </div>
              ) : (
                templates.map((template: CommitmentTemplate) => (
                  <div key={template.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{template.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Dia {template.dayOfMonth} · {formatCLP(template.amount)} · {WORKSPACE_LABELS[template.workspace] ?? template.workspace}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={template.isActive !== false}
                          onCheckedChange={(checked) =>
                            updateTemplateMutation.mutate({ id: template.id, data: { isActive: checked } })
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => deleteTemplateMutation.mutate(template.id)}
                          disabled={deleteTemplateMutation.isPending}
                        >
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                    {template.matchingKeywords.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {template.matchingKeywords.map((keyword) => (
                          <Badge key={keyword} variant="secondary" className="text-[10px]">
                            {keyword}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
