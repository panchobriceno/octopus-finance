import { useState, useMemo, useEffect, type ReactNode } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatCLP, formatDate } from "@/lib/utils";
import {
  useTransactions,
  useClientPayments,
  useCategories,
  useItems,
  useAccounts,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useBulkDeleteTransactions,
  useDashboardPreferences,
  useUpdateDashboardPreferences,
} from "@/lib/hooks";
import type { Transaction, Category, Item, Account } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  DollarSign, TrendingUp, TrendingDown, Wallet, Plus, Trash2, Pencil, X, CreditCard, GripVertical, Eye, EyeOff, Settings2, Save,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  buildMonthlySummaries,
  combineFinancialTransactions,
  getCurrentMonthKey,
  getVatProjectionDateForMonth,
  getTransactionExpenseImpact,
  getTransactionIncomeImpact,
  normalizeTransaction,
  summarizeClientPaymentsByMonth,
  summarizeWorkspaceTransactions,
} from "@/lib/finance";
import { getMonthlyBalances } from "@/lib/monthly-balances";
import { getCreditCards } from "@/lib/credit-cards";

const FAMILY_CATEGORY_HINTS = [
  "dividendo",
  "gastos comunes",
  "gastos basicos",
  "auto",
  "comida",
  "farmacia",
  "seguros",
  "educacion",
  "salud",
  "digital",
  "ocio",
  "tc javi",
  "t.c javi",
  "tc pancho",
  "t.c pancho",
  "consulta javi",
  "nana",
];

function normalizeHint(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function workspaceLabel(workspace: "business" | "family" | "dentist") {
  if (workspace === "business") return "Empresa";
  if (workspace === "family") return "Familia";
  return "Consulta Dentista";
}

function accountWorkspaceLabel(workspace?: string | null): "business" | "family" | "dentist" {
  if (workspace === "family") return "family";
  if (workspace === "dentist") return "dentist";
  return "business";
}

function accountDisplayName(account: Account) {
  return `${account.name} — ${account.bank}`;
}

function isCreditCardPurchaseMovement({
  movementType,
  paymentMethod,
}: {
  movementType: "income" | "expense" | "transfer" | "credit_card_payment";
  paymentMethod: "cash" | "bank_account" | "credit_card";
}) {
  return movementType === "expense" && paymentMethod === "credit_card";
}

const DASHBOARD_CARD_IDS = [
  "kpi-balance",
  "kpi-ingresos",
  "kpi-gastos",
  "kpi-margen",
  "caja-empresa",
  "caja-familia",
  "caja-dentista",
  "deuda-tarjetas",
  "ahorro",
  "iva-cobrado",
  "iva-proyectado",
  "caja-sin-iva",
  "balance-apertura",
] as const;

type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

function normalizeDashboardPreferences(preferences: { cardOrder?: string[]; hiddenCards?: string[] } | null) {
  const knownIds = new Set<string>(DASHBOARD_CARD_IDS);
  const ordered = (preferences?.cardOrder ?? []).filter((id): id is DashboardCardId => knownIds.has(id));
  const missing = DASHBOARD_CARD_IDS.filter((id) => !ordered.includes(id));
  const hiddenCards = (preferences?.hiddenCards ?? []).filter((id): id is DashboardCardId => knownIds.has(id));

  return {
    cardOrder: [...ordered, ...missing],
    hiddenCards,
  };
}

function SortableDashboardCard({
  id,
  hidden,
  isConfigMode,
  onToggleHidden,
  children,
}: {
  id: DashboardCardId;
  hidden: boolean;
  isConfigMode: boolean;
  onToggleHidden: (id: DashboardCardId) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  if (!isConfigMode) {
    return <>{children}</>;
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.7 : hidden ? 0.55 : 1,
      }}
      className="relative"
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onToggleHidden(id)}
        >
          {hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </Button>
      </div>
      {children}
    </div>
  );
}

// ── KPI Card ────────────────────────────────────────────────────
function KPICard({
  title,
  value,
  icon: Icon,
  trend,
  color,
}: {
  title: string;
  value: string;
  icon: any;
  trend?: string;
  color: string;
}) {
  return (
    <Card
      data-testid={`kpi-${title.toLowerCase().replace(/\s/g, "-")}`}
      className="glass glow-card overflow-hidden rounded-xl border-white/5 bg-[#1a172a]/85"
    >
      <CardContent className="px-5 pb-5 pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-[#aea8be]">{title}</p>
            <p className="glow-text-primary mt-2 text-2xl font-extrabold tracking-tight tabular-nums text-[#ece5fc]">
              {value}
            </p>
            {trend && (
              <p className="mt-2 text-xs text-[#aea8be]">{trend}</p>
            )}
          </div>
          <div
            className="rounded-xl border border-white/5 p-3"
            style={{ backgroundColor: `${color}18` }}
          >
            <Icon className="size-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Transaction Form (shared between create & edit) ─────────────
interface TransactionFormProps {
  mode: "create" | "edit";
  categories: Category[];
  items: Item[];
  accounts: Account[];
  initialValues?: {
    categoryId: string;
    itemId: string;
    amount: string;
    date: string;
    subtype: "actual" | "planned";
    status: "pending" | "paid" | "cancelled";
    workspace: "business" | "family" | "dentist";
    movementType: "income" | "expense" | "transfer" | "credit_card_payment";
    paymentMethod: "cash" | "bank_account" | "credit_card";
    accountId: string;
    destinationWorkspace: "business" | "family" | "dentist";
    creditCardName: string;
    installmentCount: string;
    notes: string;
  };
  isPending: boolean;
  onSubmit: (data: {
    categoryId: string;
    itemId: string;
    amount: string;
    date: string;
    subtype: "actual" | "planned";
    status: "pending" | "paid" | "cancelled";
    workspace: "business" | "family" | "dentist";
    movementType: "income" | "expense" | "transfer" | "credit_card_payment";
    paymentMethod: "cash" | "bank_account" | "credit_card";
    accountId: string;
    destinationWorkspace: "business" | "family" | "dentist";
    creditCardName: string;
    installmentCount: string;
    notes: string;
  }) => void;
  onCancel?: () => void;
}

function InternalMovementForm({
  accounts,
  isPending,
  onSubmit,
}: {
  accounts: Account[];
  isPending: boolean;
  onSubmit: (data: {
    movementType: "transfer" | "credit_card_payment";
    sourceAccountId: string;
    destinationAccountId: string;
    destinationCardName: string;
    amount: string;
    date: string;
    notes: string;
  }) => void;
}) {
  const { toast } = useToast();
  const [creditCards, setCreditCards] = useState<string[]>([]);
  const [movementType, setMovementType] = useState<"transfer" | "credit_card_payment">("transfer");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState("");
  const [destinationCardName, setDestinationCardName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setCreditCards(getCreditCards());
    sync();
    window.addEventListener("octopus-credit-cards-updated", sync);
    return () => window.removeEventListener("octopus-credit-cards-updated", sync);
  }, []);

  const destinationAccounts = useMemo(
    () => accounts.filter((account) => account.id !== sourceAccountId),
    [accounts, sourceAccountId],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!sourceAccountId) {
      toast({ title: "Selecciona la cuenta origen", variant: "destructive" });
      return;
    }

    if (!amount || Number(amount) <= 0) {
      toast({ title: "Ingresa un monto válido", variant: "destructive" });
      return;
    }

    if (movementType === "transfer" && !destinationAccountId) {
      toast({ title: "Selecciona la cuenta destino", variant: "destructive" });
      return;
    }

    if (movementType === "credit_card_payment" && !destinationCardName.trim()) {
      toast({ title: "Selecciona la tarjeta destino", variant: "destructive" });
      return;
    }

    onSubmit({
      movementType,
      sourceAccountId,
      destinationAccountId,
      destinationCardName,
      amount,
      date,
      notes,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Tipo</p>
        <Select
          value={movementType}
          onValueChange={(value) => {
            setMovementType(value as "transfer" | "credit_card_payment");
            setDestinationAccountId("");
            setDestinationCardName("");
          }}
        >
          <SelectTrigger data-testid="select-internal-movement-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="transfer">Transferencia entre cuentas</SelectItem>
            <SelectItem value="credit_card_payment">Pago de tarjeta de crédito</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Cuenta origen</p>
        <Select value={sourceAccountId} onValueChange={setSourceAccountId}>
          <SelectTrigger data-testid="select-transfer-source-account">
            <SelectValue placeholder="Seleccionar cuenta" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {accountDisplayName(account)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Destino</p>
        {movementType === "transfer" ? (
          <Select value={destinationAccountId} onValueChange={setDestinationAccountId}>
            <SelectTrigger data-testid="select-transfer-destination-account">
              <SelectValue placeholder="Seleccionar cuenta destino" />
            </SelectTrigger>
            <SelectContent>
              {destinationAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {accountDisplayName(account)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : creditCards.length > 0 ? (
          <Select value={destinationCardName} onValueChange={setDestinationCardName}>
            <SelectTrigger data-testid="select-transfer-destination-card">
              <SelectValue placeholder="Seleccionar tarjeta" />
            </SelectTrigger>
            <SelectContent>
              {creditCards.map((card) => (
                <SelectItem key={card} value={card}>
                  {card}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={destinationCardName}
            onChange={(e) => setDestinationCardName(e.target.value)}
            placeholder="Nombre tarjeta"
            data-testid="input-transfer-destination-card"
          />
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Monto</p>
        <Input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Monto"
          data-testid="input-transfer-amount"
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Fecha</p>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          data-testid="input-transfer-date"
        />
      </div>

      <div className="sm:col-span-2 lg:col-span-3">
        <Textarea
          placeholder="Notas (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="resize-none"
          data-testid="input-transfer-notes"
        />
      </div>

      <div className="sm:col-span-2 lg:col-span-3">
        <Button
          type="submit"
          className="w-full"
          disabled={isPending}
          data-testid="button-add-transfer"
        >
          {isPending ? "Guardando..." : "Agregar movimiento interno"}
        </Button>
      </div>
    </form>
  );
}

function TransactionForm({
  mode,
  categories,
  items,
  accounts,
  initialValues,
  isPending,
  onSubmit,
  onCancel,
}: TransactionFormProps) {
  const { toast } = useToast();
  const [creditCards, setCreditCards] = useState<string[]>([]);
  const defaults = initialValues ?? {
    categoryId: "",
    itemId: "",
    amount: "",
    date: new Date().toISOString().split("T")[0],
    subtype: "actual" as const,
    status: "paid" as const,
    workspace: "business" as const,
    movementType: "income" as const,
    paymentMethod: "bank_account" as const,
    accountId: "",
    destinationWorkspace: "family" as const,
    creditCardName: "",
    installmentCount: "1",
    notes: "",
  };

  const [formCategoryId, setFormCategoryId] = useState(defaults.categoryId);
  const [formItemId, setFormItemId] = useState(defaults.itemId);
  const [formAmount, setFormAmount] = useState(defaults.amount);
  const [formDate, setFormDate] = useState(defaults.date);
  const [formSubtype, setFormSubtype] = useState(defaults.subtype);
  const [formStatus, setFormStatus] = useState(defaults.status);
  const [formWorkspace, setFormWorkspace] = useState(defaults.workspace);
  const [formMovementType, setFormMovementType] = useState(defaults.movementType);
  const [formPaymentMethod, setFormPaymentMethod] = useState(defaults.paymentMethod);
  const [formAccountId, setFormAccountId] = useState(defaults.accountId);
  const [formDestinationWorkspace, setFormDestinationWorkspace] = useState(defaults.destinationWorkspace);
  const [formCreditCardName, setFormCreditCardName] = useState(defaults.creditCardName);
  const [formInstallmentCount, setFormInstallmentCount] = useState(defaults.installmentCount);
  const [formNotes, setFormNotes] = useState(defaults.notes);
  const isCreditCardPurchase = isCreditCardPurchaseMovement({
    movementType: formMovementType,
    paymentMethod: formPaymentMethod,
  });
  const canKeepPaidCreditCardPurchase = mode === "edit" && defaults.status === "paid";

  const effectiveType = formMovementType === "income" ? "income" : "expense";
  const filteredCategories = categories.filter((c) => c.type === effectiveType);
  const filteredItems = items.filter((i) => i.categoryId === formCategoryId);
  const categoryRequired = formMovementType === "income" || formMovementType === "expense";
  const selectableBankAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        const isBankType = account.type === "checking" || account.type === "savings";
        const isActive = (account as Account & { isActive?: boolean }).isActive ?? true;
        return isBankType && isActive;
      }),
    [accounts],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setCreditCards(getCreditCards());
    sync();
    window.addEventListener("octopus-credit-cards-updated", sync);
    return () => window.removeEventListener("octopus-credit-cards-updated", sync);
  }, []);

  useEffect(() => {
    if (!formCategoryId || !categoryRequired) return;

    const selectedCategory = categories.find((category) => category.id === formCategoryId);
    if (!selectedCategory || selectedCategory.type !== "expense") return;

    const normalizedCategoryName = normalizeHint(selectedCategory.name);
    const isFamilyCategory = FAMILY_CATEGORY_HINTS.some((hint) => normalizedCategoryName.includes(hint));

    setFormWorkspace(isFamilyCategory ? "family" : "business");
  }, [categories, categoryRequired, formCategoryId]);

  useEffect(() => {
    if (!isCreditCardPurchase) return;
    if (formStatus !== "paid") return;
    if (canKeepPaidCreditCardPurchase) return;

    setFormStatus("pending");
  }, [canKeepPaidCreditCardPurchase, formStatus, isCreditCardPurchase]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formAmount) {
      toast({ title: "Falta el monto", variant: "destructive" });
      return;
    }
    if (!formDate) {
      toast({ title: "Falta la fecha", variant: "destructive" });
      return;
    }
    if (!formCategoryId && categoryRequired) {
      toast({ title: "Selecciona una categoría", variant: "destructive" });
      return;
    }
    if ((formMovementType === "credit_card_payment" || formPaymentMethod === "credit_card") && !formCreditCardName.trim()) {
      toast({ title: "Escribe el nombre de la tarjeta", variant: "destructive" });
      return;
    }
    if (isCreditCardPurchase && formStatus === "paid" && !canKeepPaidCreditCardPurchase) {
      toast({
        title: "Usa Pago TC para liquidar compras con tarjeta",
        description: "Las compras hechas con tarjeta se registran como pendientes y se liquidan con un Pago TC separado.",
        variant: "destructive",
      });
      return;
    }
    onSubmit({
      categoryId: formCategoryId,
      itemId: formItemId,
      amount: formAmount,
      date: formDate,
      subtype: formSubtype,
      status: formStatus,
      workspace: formWorkspace,
      movementType: formMovementType,
      paymentMethod: formPaymentMethod,
      accountId: formPaymentMethod === "bank_account" && formMovementType !== "transfer" ? formAccountId : "",
      destinationWorkspace: formDestinationWorkspace,
      creditCardName: formCreditCardName,
      installmentCount: formInstallmentCount,
      notes: formNotes,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Ambito</p>
        <Select value={formWorkspace} onValueChange={(v) => setFormWorkspace(v as "business" | "family" | "dentist")}>
          <SelectTrigger data-testid="select-workspace">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="business">Empresa</SelectItem>
            <SelectItem value="family">Familia</SelectItem>
            <SelectItem value="dentist">Consulta Dentista</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Tipo de movimiento</p>
        <Select
          value={formMovementType}
          onValueChange={(v) => {
            const movementType = v as "income" | "expense" | "transfer" | "credit_card_payment";
            setFormMovementType(movementType);
            setFormCategoryId("");
            setFormItemId("");
            setFormInstallmentCount("1");
            if (movementType === "income") {
              setFormPaymentMethod("bank_account");
            } else {
              setFormPaymentMethod("bank_account");
            }
            if (movementType === "credit_card_payment") {
              setFormAccountId("");
            }
          }}
        >
          <SelectTrigger data-testid="select-movement-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="income">Ingreso</SelectItem>
            <SelectItem value="expense">Gasto</SelectItem>
            {mode === "edit" ? (
              <>
                <SelectItem value="credit_card_payment">Pago tarjeta</SelectItem>
                <SelectItem value="transfer">Transferencia</SelectItem>
              </>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {formMovementType === "transfer"
            ? "Destino"
            : formMovementType === "credit_card_payment"
            ? "Tarjeta"
            : "Categoria"}
        </p>
        {formMovementType === "transfer" ? (
          <Select value={formDestinationWorkspace} onValueChange={(v) => setFormDestinationWorkspace(v as "business" | "family" | "dentist")}>
            <SelectTrigger data-testid="select-destination-workspace">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["business", "family", "dentist"] as const)
                .filter((workspace) => workspace !== formWorkspace)
                .map((workspace) => (
                  <SelectItem key={workspace} value={workspace}>
                    {workspace === "business" ? "Empresa" : workspace === "family" ? "Familia" : "Consulta Dentista"}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        ) : formMovementType === "credit_card_payment" ? (
          <Input
            placeholder="Nombre tarjeta"
            value={formCreditCardName}
            onChange={(e) => setFormCreditCardName(e.target.value)}
            data-testid="input-credit-card-name"
          />
        ) : (
          <Select
            value={formCategoryId}
            onValueChange={(v) => {
              setFormCategoryId(v);
              setFormItemId("");
            }}
            disabled={!categoryRequired}
          >
            <SelectTrigger data-testid="select-category">
              <SelectValue placeholder={categoryRequired ? "Categoria" : "No aplica"} />
            </SelectTrigger>
            <SelectContent>
              {filteredCategories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Subcategoria</p>
        <Select
          value={formItemId}
          onValueChange={setFormItemId}
          disabled={!formCategoryId || !categoryRequired}
        >
          <SelectTrigger data-testid="select-subcategory">
            <SelectValue placeholder={formCategoryId ? "Subcategoría (opcional)" : "Elegir categoría primero"} />
          </SelectTrigger>
          <SelectContent>
            {filteredItems.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
            {filteredItems.length === 0 && formCategoryId && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No hay subcategorías para esta categoría
              </div>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Monto</p>
        <Input
          type="number"
          placeholder="Monto"
          value={formAmount}
          onChange={(e) => setFormAmount(e.target.value)}
          data-testid="input-amount"
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Fecha</p>
        <Input
          type="date"
          value={formDate}
          onChange={(e) => setFormDate(e.target.value)}
          data-testid="input-date"
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Metodo de pago</p>
        {formMovementType === "expense" ? (
          <Select
            value={formPaymentMethod}
            onValueChange={(v) => {
              const paymentMethod = v as "cash" | "bank_account" | "credit_card";
              setFormPaymentMethod(paymentMethod);
              if (paymentMethod !== "bank_account") {
                setFormAccountId("");
              }
            }}
            data-testid="select-payment-method"
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Efectivo</SelectItem>
              <SelectItem value="bank_account">Cuenta bancaria</SelectItem>
              <SelectItem value="credit_card">Tarjeta de crédito</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={formMovementType === "income" ? "No aplica" : formMovementType === "transfer" ? "Transferencia" : "Pago tarjeta"}
            readOnly
          />
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Cuenta</p>
        {formMovementType !== "transfer" && formMovementType !== "credit_card_payment" && formPaymentMethod === "bank_account" ? (
          <Select value={formAccountId} onValueChange={setFormAccountId}>
            <SelectTrigger data-testid="select-account">
              <SelectValue placeholder="Seleccionar cuenta" />
            </SelectTrigger>
            <SelectContent>
              {selectableBankAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name} — {account.bank}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input value="No aplica" readOnly />
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Estado</p>
        <Select value={formSubtype} onValueChange={(v) => setFormSubtype(v as "actual" | "planned")}>
          <SelectTrigger data-testid="select-subtype">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="actual">Ejecutado</SelectItem>
            <SelectItem value="planned">Presupuestado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Situacion</p>
        <Select value={formStatus} onValueChange={(v) => setFormStatus(v as "pending" | "paid" | "cancelled")}>
          <SelectTrigger data-testid="select-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pendiente</SelectItem>
            <SelectItem value="paid" disabled={isCreditCardPurchase && !canKeepPaidCreditCardPurchase}>
              Pagado
            </SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        {isCreditCardPurchase ? (
          <p className="text-[11px] text-muted-foreground">
            Las compras con tarjeta se liquidan mediante un Pago TC, no cambiando esta fila a pagado.
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {formMovementType === "credit_card_payment" || formPaymentMethod === "credit_card" ? "Tarjeta" : "Referencia"}
        </p>
        {(formMovementType === "credit_card_payment" || formPaymentMethod === "credit_card") ? (
          creditCards.length > 0 ? (
            <Select value={formCreditCardName} onValueChange={setFormCreditCardName}>
              <SelectTrigger data-testid="input-credit-card-name">
                <SelectValue placeholder="Seleccionar tarjeta" />
              </SelectTrigger>
              <SelectContent>
                {creditCards.map((card) => (
                  <SelectItem key={card} value={card}>
                    {card}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              placeholder="Nombre tarjeta"
              value={formCreditCardName}
              onChange={(e) => setFormCreditCardName(e.target.value)}
              data-testid="input-credit-card-name"
            />
          )
        ) : mode === "create" ? (
          <Input value="-" readOnly />
        ) : (
          <Input value="-" readOnly />
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {formPaymentMethod === "credit_card" && formMovementType === "expense" ? "Cuotas" : "Detalle"}
        </p>
        {formPaymentMethod === "credit_card" && formMovementType === "expense" ? (
          <Select value={formInstallmentCount} onValueChange={setFormInstallmentCount} data-testid="select-installment-count">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["1", "2", "3", "6", "12"].map((count) => (
                <SelectItem key={count} value={count}>
                  {count} cuota{count === "1" ? "" : "s"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : mode === "create" ? (
          <Input value="-" readOnly />
        ) : (
          <Input value="-" readOnly />
        )}
      </div>

      {(formPaymentMethod === "credit_card" && formMovementType === "expense") && (
        <div className="sm:col-span-2 lg:col-span-4 rounded-lg border border-amber-200/70 bg-amber-50/60 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          La compra se registra como gasto en este mes. Las cuotas quedan informadas por ahora y luego podremos desglosarlas y ajustarlas manualmente segun la cartola.
        </div>
      )}

      {/* Row 3 — Notes (full width) */}
      <div className="sm:col-span-2 lg:col-span-4">
        <Textarea
          placeholder="Notas (opcional)"
          value={formNotes}
          onChange={(e) => setFormNotes(e.target.value)}
          rows={2}
          className="resize-none"
          data-testid="input-notes"
        />
      </div>

      <div className="sm:col-span-2 lg:col-span-4">
        {mode === "create" ? (
          <Button
            type="submit"
            className="w-full"
            disabled={isPending}
            data-testid="button-add-transaction"
          >
            {isPending ? "Guardando..." : "Agregar"}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              type="submit"
              className="flex-1"
              disabled={isPending}
              data-testid="button-save-transaction"
            >
              {isPending ? "Guardando..." : "Guardar"}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-edit">
                <X className="size-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

// ── Main Page ────────────────────────────────────────────────────
export default function OverviewPage() {
  const [createFormMode, setCreateFormMode] = useState<"transaction" | "internal">("transaction");
  const [isConfigMode, setIsConfigMode] = useState(false);
  const [draftCardOrder, setDraftCardOrder] = useState<DashboardCardId[]>([...DASHBOARD_CARD_IDS]);
  const [draftHiddenCards, setDraftHiddenCards] = useState<DashboardCardId[]>([]);
  const [selectedAccountFilter, setSelectedAccountFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [showBulkEditDialog, setShowBulkEditDialog] = useState(false);
  const [creditCards, setCreditCards] = useState<string[]>([]);
  const [payDialog, setPayDialog] = useState<{
    tx: Transaction;
    amount: string;
    paymentMethod: "cash" | "bank_account" | "credit_card";
    accountId: string;
    creditCardName: string;
    installmentCount: string;
  } | null>(null);
  const [bulkEditCategory, setBulkEditCategory] = useState("__keep__");
  const [bulkEditWorkspace, setBulkEditWorkspace] = useState("__keep__");
  const [bulkEditStatus, setBulkEditStatus] = useState("__keep__");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const { toast } = useToast();

  const { data: transactions = [], isLoading: txLoading } = useTransactions();
  const { data: clientPayments = [] } = useClientPayments();
  const { data: categories = [] } = useCategories();
  const { data: items = [] } = useItems();
  const { data: accounts = [] } = useAccounts();
  const { data: dashboardPreferences } = useDashboardPreferences();
  const updateDashboardPreferencesMutation = useUpdateDashboardPreferences();
  const currentMonthKey = getCurrentMonthKey();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const openingBalance = useMemo(
    () =>
      accounts.reduce(
        (sum, account) => sum + (account.type !== "savings" ? (account.currentBalance ?? 0) : 0),
        0,
      ),
    [accounts],
  );
  const savingsBalance = useMemo(
    () =>
      accounts.reduce(
        (sum, account) => sum + (account.type === "savings" ? (account.currentBalance ?? 0) : 0),
        0,
      ),
    [accounts],
  );

  // Lookup maps
  const categoryMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const itemMap = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);

  // Reverse lookups: category name → id
  const categoryNameToId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) map[c.name] = c.id;
    return map;
  }, [categories]);

  const transactionCategoryOptions = useMemo(
    () => Array.from(new Set(transactions.map((tx) => tx.category))).sort((a, b) => a.localeCompare(b)),
    [transactions],
  );
  const activeBankAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        const isBankType = account.type === "checking" || account.type === "savings";
        const isActive = (account as Account & { isActive?: boolean }).isActive ?? true;
        return isBankType && isActive;
      }),
    [accounts],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountFilter) ?? null,
    [accounts, selectedAccountFilter],
  );
  const filteredSavingsBalance = selectedAccount
    ? selectedAccount.type === "savings"
      ? (selectedAccount.currentBalance ?? 0)
      : 0
    : savingsBalance;
  const selectedTransactionsForBulkEdit = useMemo(
    () => transactions.filter((tx) => selectedIds.has(tx.id)),
    [selectedIds, transactions],
  );
  const bulkEditIncludesCreditCardPurchases = useMemo(
    () =>
      selectedTransactionsForBulkEdit.some((tx) => {
        const normalized = normalizeTransaction(tx);
        return isCreditCardPurchaseMovement({
          movementType: normalized.movementType,
          paymentMethod: normalized.paymentMethod,
        }) && tx.status !== "paid";
      }),
    [selectedTransactionsForBulkEdit],
  );
  const normalizedDashboardPreferences = useMemo(
    () => normalizeDashboardPreferences(dashboardPreferences ?? null),
    [dashboardPreferences],
  );
  const activeCardOrder = isConfigMode ? draftCardOrder : normalizedDashboardPreferences.cardOrder;
  const activeHiddenCards = isConfigMode ? draftHiddenCards : normalizedDashboardPreferences.hiddenCards;
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (selectedAccountFilter !== "all" && tx.accountId !== selectedAccountFilter) return false;
      if (filterCategory !== "all" && tx.category !== filterCategory) return false;
      if (filterFromDate && tx.date < filterFromDate) return false;
      if (filterToDate && tx.date > filterToDate) return false;
      return true;
    });
  }, [transactions, selectedAccountFilter, filterCategory, filterFromDate, filterToDate]);

  // Visible transactions (limited to 50)
  const visibleTransactions = filteredTransactions.slice(0, 50);

  // ── Mutations ──
  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();
  const bulkDeleteMutation = useBulkDeleteTransactions();

  // ── KPI calculations ──
  const financialTransactions = useMemo(
    () => combineFinancialTransactions(transactions, clientPayments),
    [transactions, clientPayments],
  );
  const filteredFinancialTransactions = useMemo(
    () =>
      selectedAccountFilter === "all"
        ? financialTransactions
        : financialTransactions.filter((tx) => tx.accountId === selectedAccountFilter),
    [financialTransactions, selectedAccountFilter],
  );
  const businessMetrics = useMemo(
    () => summarizeWorkspaceTransactions(filteredFinancialTransactions, "business", accounts),
    [accounts, filteredFinancialTransactions],
  );
  const familyMetrics = useMemo(
    () => summarizeWorkspaceTransactions(filteredFinancialTransactions, "family", accounts),
    [accounts, filteredFinancialTransactions],
  );
  const dentistMetrics = useMemo(
    () => summarizeWorkspaceTransactions(filteredFinancialTransactions, "dentist", accounts),
    [accounts, filteredFinancialTransactions],
  );
  const totalIncome = filteredFinancialTransactions.reduce((sum, tx) => sum + getTransactionIncomeImpact(tx, "all"), 0);
  const totalExpenses = filteredFinancialTransactions.reduce((sum, tx) => sum + getTransactionExpenseImpact(tx, "all"), 0);
  const balance = totalIncome - totalExpenses;
  const filteredClientPayments = useMemo(
    () => (selectedAccountFilter === "all" ? clientPayments : []),
    [clientPayments, selectedAccountFilter],
  );
  const clientPaymentsByMonth = useMemo(
    () => summarizeClientPaymentsByMonth(filteredClientPayments),
    [filteredClientPayments],
  );
  const currentMonthPaidVat = clientPaymentsByMonth[currentMonthKey]?.paidVat ?? 0;
  const nextVatDueDate = getVatProjectionDateForMonth(currentMonthKey);
  const businessAvailableAfterVat = businessMetrics.cashFlow - currentMonthPaidVat;
  const currentMonthRealIncome = useMemo(() => {
    const paidClientIncome = filteredClientPayments.reduce((sum, payment) => {
      const referenceDate = payment.paymentDate ?? payment.expectedDate ?? payment.dueDate ?? payment.issueDate ?? "";
      if (payment.status !== "paid" || !referenceDate.startsWith(currentMonthKey)) return sum;
      return sum + payment.netAmount;
    }, 0);

    const actualIncomeTransactions = filteredFinancialTransactions.reduce((sum, tx) => {
      if (
        tx.type !== "income" ||
        tx.subtype !== "actual" ||
        tx.status !== "paid" ||
        tx.sourceClientPaymentId ||
        !tx.date.startsWith(currentMonthKey)
      ) {
        return sum;
      }

      return sum + tx.amount;
    }, 0);

    return paidClientIncome + actualIncomeTransactions;
  }, [currentMonthKey, filteredClientPayments, filteredFinancialTransactions]);
  const currentMonthProjectedIncome = useMemo(
    () =>
      filteredClientPayments.reduce((sum, payment) => {
        const referenceDate = payment.expectedDate ?? payment.dueDate ?? payment.issueDate ?? "";
        if (!referenceDate.startsWith(currentMonthKey)) return sum;
        if (
          payment.status !== "invoiced" &&
          payment.status !== "receivable" &&
          payment.status !== "projected"
        ) {
          return sum;
        }

        return sum + payment.netAmount;
      }, 0),
    [currentMonthKey, filteredClientPayments],
  );
  const currentMonthExpenseTotal = useMemo(
    () =>
      filteredFinancialTransactions.reduce((sum, tx) => {
        if (!tx.date.startsWith(currentMonthKey)) return sum;
        return sum + getTransactionExpenseImpact(tx, "all");
      }, 0),
    [currentMonthKey, filteredFinancialTransactions],
  );
  const currentMonthMargin =
    currentMonthRealIncome > 0
      ? ((currentMonthRealIncome - currentMonthExpenseTotal) / currentMonthRealIncome) * 100
      : 0;
  const summaryOpeningBalance = selectedAccount ? (selectedAccount.currentBalance ?? 0) : openingBalance;
  const currentMonthSummary = useMemo(() => {
    const openingBalances = {
      ...getMonthlyBalances(),
      [currentMonthKey]: summaryOpeningBalance,
    };

    return buildMonthlySummaries(filteredFinancialTransactions, openingBalances).find(
      (summary) => summary.monthKey === currentMonthKey,
    ) ?? {
      monthKey: currentMonthKey,
      label: "",
      openingBalance: summaryOpeningBalance,
      realIncome: 0,
      realExpenses: 0,
      plannedIncome: 0,
      plannedExpenses: 0,
      realEndingBalance: summaryOpeningBalance,
      projectedEndingBalance: summaryOpeningBalance,
      hasRealData: false,
      hasPlannedData: false,
    };
  }, [filteredFinancialTransactions, currentMonthKey, summaryOpeningBalance]);
  const unassignedCurrentMonthTransactions = useMemo(
    () => transactions.filter((tx) => tx.date.startsWith(currentMonthKey) && !tx.accountId).length,
    [currentMonthKey, transactions],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setCreditCards(getCreditCards());
    sync();
    window.addEventListener("octopus-credit-cards-updated", sync);
    return () => window.removeEventListener("octopus-credit-cards-updated", sync);
  }, []);

  useEffect(() => {
    if (isConfigMode) return;
    setDraftCardOrder(normalizedDashboardPreferences.cardOrder);
    setDraftHiddenCards(normalizedDashboardPreferences.hiddenCards);
  }, [isConfigMode, normalizedDashboardPreferences]);

  // Monthly chart data
  const chartData = useMemo(() => {
    const monthlyData: Record<string, { month: string; ingresos: number; gastos: number }> = {};
    for (const tx of financialTransactions) {
      const month = tx.date.substring(0, 7);
      if (!monthlyData[month]) {
        const [y, m] = month.split("-");
        const monthNames = [
          "Ene", "Feb", "Mar", "Abr", "May", "Jun",
          "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
        ];
        monthlyData[month] = {
          month: `${monthNames[parseInt(m) - 1]} ${y}`,
          ingresos: 0,
          gastos: 0,
        };
      }
      monthlyData[month].ingresos += getTransactionIncomeImpact(tx, "all");
      monthlyData[month].gastos += getTransactionExpenseImpact(tx, "all");
    }
    return Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [financialTransactions]);

  const dashboardCards = useMemo(
    () =>
      ({
        "kpi-balance": {
          id: "kpi-balance" as DashboardCardId,
          className: "",
          content: (
            <KPICard
              title="Balance"
              value={formatCLP(balance)}
              icon={Wallet}
              color={balance >= 0 ? "#10b981" : "#ef4444"}
              trend={`${transactions.length} transacciones`}
            />
          ),
        },
        "kpi-ingresos": {
          id: "kpi-ingresos" as DashboardCardId,
          className: "",
          content: (
            <Card data-testid="kpi-ingresos" className="glass glow-card overflow-hidden rounded-xl border-white/5 bg-[#1a172a]/85">
              <CardContent className="px-5 pb-5 pt-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#aea8be]">Ingresos</p>
                    <p className="glow-text-primary mt-2 text-2xl font-extrabold tracking-tight tabular-nums text-[#bcffe0]">
                      {formatCLP(currentMonthRealIncome)}
                    </p>
                    <p className="mt-2 text-xs text-[#aea8be]">
                      Proyectado: {formatCLP(currentMonthProjectedIncome)}
                    </p>
                  </div>
                  <div
                    className="rounded-xl border border-white/5 p-3"
                    style={{ backgroundColor: `${"#bcffe0"}15` }}
                  >
                    <TrendingUp className="size-5" style={{ color: "#bcffe0" }} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ),
        },
        "kpi-gastos": {
          id: "kpi-gastos" as DashboardCardId,
          className: "",
          content: (
            <KPICard
              title="Gastos"
              value={formatCLP(totalExpenses)}
              icon={TrendingDown}
              color="#ef4444"
            />
          ),
        },
        "kpi-margen": {
          id: "kpi-margen" as DashboardCardId,
          className: "",
          content: (
            <KPICard
              title="Margen"
              value={
                currentMonthRealIncome > 0
                  ? `${currentMonthMargin.toFixed(1)}%`
                  : "0%"
              }
              icon={DollarSign}
              color="#3b82f6"
            />
          ),
        },
        "caja-empresa": {
          id: "caja-empresa" as DashboardCardId,
          className: "",
          content: (
            <Card className="glass glow-card rounded-xl border-white/5 bg-[#1a172a]/85">
              <CardContent className="pt-5">
                <p className="text-sm text-[#aea8be]">Empresa: caja real</p>
                <p className="glow-text-primary mt-2 text-2xl font-bold tabular-nums">{formatCLP(businessMetrics.cashFlow)}</p>
                <p className="mt-2 text-xs text-[#aea8be]">Ingresos y gastos de empresa, considerando tarjetas</p>
              </CardContent>
            </Card>
          ),
        },
        "caja-familia": {
          id: "caja-familia" as DashboardCardId,
          className: "",
          content: (
            <Card className="glass glow-card rounded-xl border-white/5 bg-[#1a172a]/85">
              <CardContent className="pt-5">
                <p className="text-sm text-[#aea8be]">Familia: caja real</p>
                <p className="glow-text-primary mt-2 text-2xl font-bold tabular-nums">{formatCLP(familyMetrics.cashFlow)}</p>
                <p className="mt-2 text-xs text-[#aea8be]">Incluye transferencias recibidas desde empresa</p>
              </CardContent>
            </Card>
          ),
        },
        "caja-dentista": {
          id: "caja-dentista" as DashboardCardId,
          className: "",
          content: (
            <Card className="glass glow-card rounded-xl border-white/5 bg-[#1a172a]/85">
              <CardContent className="pt-5">
                <p className="text-sm text-[#aea8be]">Consulta Dentista: caja real</p>
                <p className="glow-text-primary mt-2 text-2xl font-bold tabular-nums">{formatCLP(dentistMetrics.cashFlow)}</p>
                <p className="mt-2 text-xs text-[#aea8be]">Ingresos y gastos del ámbito consulta</p>
              </CardContent>
            </Card>
          ),
        },
        "deuda-tarjetas": {
          id: "deuda-tarjetas" as DashboardCardId,
          className: "",
          content: (
            <Card className="glass glow-card rounded-xl border-white/5 bg-[#1a172a]/85">
              <CardContent className="pt-5">
                <div className="flex items-center gap-2">
                  <CreditCard className="size-4 text-[#ff6e84]" />
                  <p className="text-sm text-[#aea8be]">Deuda tarjetas empresa</p>
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums text-[#ff6e84]">{formatCLP(businessMetrics.creditCardDebt)}</p>
                <p className="mt-2 text-xs text-[#aea8be]">Compras TC menos pagos de tarjeta</p>
              </CardContent>
            </Card>
          ),
        },
        ahorro: {
          id: "ahorro" as DashboardCardId,
          className: "",
          content: (
            <Card className="glass glow-card rounded-xl border-white/5 bg-[#1a172a]/85">
              <CardContent className="pt-5">
                <p className="text-sm text-[#aea8be]">Ahorro</p>
                <p className="glow-text-primary mt-2 text-2xl font-bold tabular-nums">
                  {formatCLP(filteredSavingsBalance)}
                </p>
                <p className="mt-2 text-xs text-[#aea8be]">
                  {selectedAccount ? "Saldo de ahorro de la cuenta seleccionada" : "Suma de cuentas de ahorro registradas"}
                </p>
              </CardContent>
            </Card>
          ),
        },
        "iva-cobrado": {
          id: "iva-cobrado" as DashboardCardId,
          className: "",
          content: (
            <Card className="glass glow-card rounded-xl border-white/5 bg-[#1a172a]/85">
              <CardContent className="pt-5">
                <p className="text-sm text-[#aea8be]">IVA cobrado este mes</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-[#bb9eff]">
                  {formatCLP(currentMonthPaidVat)}
                </p>
                <p className="mt-2 text-xs text-[#aea8be]">Se actualiza a medida que los clientes van pagando</p>
              </CardContent>
            </Card>
          ),
        },
        "iva-proyectado": {
          id: "iva-proyectado" as DashboardCardId,
          className: "",
          content: (
            <Card className="glass glow-card rounded-xl border-white/5 bg-[#1a172a]/85">
              <CardContent className="pt-5">
                <p className="text-sm text-[#aea8be]">IVA proyectado próximo 20</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-[#bb9eff]">
                  {formatCLP(currentMonthPaidVat)}
                </p>
                <p className="mt-2 text-xs text-[#aea8be]">Pago estimado para {formatDate(nextVatDueDate)}</p>
              </CardContent>
            </Card>
          ),
        },
        "caja-sin-iva": {
          id: "caja-sin-iva" as DashboardCardId,
          className: "",
          content: (
            <Card className="glass glow-card rounded-xl border-white/5 bg-[#1a172a]/85">
              <CardContent className="pt-5">
                <p className="text-sm text-[#aea8be]">Caja empresa disponible sin IVA</p>
                <p className="glow-text-primary mt-2 text-2xl font-bold tabular-nums">
                  {formatCLP(businessAvailableAfterVat)}
                </p>
                <p className="mt-2 text-xs text-[#aea8be]">Caja empresa menos IVA cobrado este mes</p>
              </CardContent>
            </Card>
          ),
        },
        "balance-apertura": {
          id: "balance-apertura" as DashboardCardId,
          className: "md:col-span-2 xl:col-span-4",
          content: (
            <Card className="glass glow-card rounded-xl border-white/5 bg-[#1a172a]/88">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-[#ece5fc]">
                  Balance de Apertura y Proyección del Mes
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[240px_1fr]">
                <div className="rounded-xl border border-white/5 bg-[#211d32]/90 p-4">
                  <p className="text-sm font-medium text-[#bb9eff]">
                    Saldo inicial
                  </p>
                  <p className="mb-3 mt-1 text-xs text-[#aea8be]">
                    {selectedAccount ? "Saldo base de la cuenta seleccionada" : "Suma de saldos en cuentas operativas registradas"}
                  </p>
                  <p className="glow-text-primary text-3xl font-extrabold tracking-tight tabular-nums text-[#ece5fc]">{formatCLP(summaryOpeningBalance)}</p>
                  <p className="mt-2 text-xs text-[#aea8be]">
                    Mes: {currentMonthKey}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-white/5 bg-[#211d32]/80 p-4">
                    <p className="text-sm text-[#aea8be]">Ejecutado</p>
                    <p className="mt-2 text-xl font-bold tabular-nums text-[#ece5fc]">
                      {formatCLP(currentMonthSummary.realEndingBalance)}
                    </p>
                    <p className="mt-2 text-xs text-[#aea8be]">
                      {formatCLP(summaryOpeningBalance)} + {formatCLP(currentMonthSummary.realIncome)} - {formatCLP(currentMonthSummary.realExpenses)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-[#211d32]/80 p-4">
                    <p className="text-sm text-[#aea8be]">Ingresos presupuestados</p>
                    <p className="mt-2 text-xl font-bold tabular-nums text-[#bcffe0]">
                      {formatCLP(currentMonthSummary.plannedIncome)}
                    </p>
                    <p className="mt-2 text-xs text-[#aea8be]">
                      No impactan el saldo real
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-[#211d32]/80 p-4">
                    <p className="text-sm text-[#aea8be]">Saldo proyectado</p>
                    <p className="mt-2 text-xl font-bold tabular-nums text-[#bb9eff]">
                      {formatCLP(currentMonthSummary.projectedEndingBalance)}
                    </p>
                    <p className="mt-2 text-xs text-[#aea8be]">
                      Ejecutado + proyectado del resto del mes
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ),
        },
      }) satisfies Record<DashboardCardId, { id: DashboardCardId; className: string; content: ReactNode }>,
    [
      balance,
      businessAvailableAfterVat,
      businessMetrics.cashFlow,
      businessMetrics.creditCardDebt,
      currentMonthKey,
      currentMonthMargin,
      currentMonthProjectedIncome,
      currentMonthPaidVat,
      currentMonthRealIncome,
      currentMonthSummary.plannedIncome,
      currentMonthSummary.projectedEndingBalance,
      currentMonthSummary.realEndingBalance,
      currentMonthSummary.realExpenses,
      currentMonthSummary.realIncome,
      currentMonthExpenseTotal,
      dentistMetrics.cashFlow,
      filteredSavingsBalance,
      familyMetrics.cashFlow,
      nextVatDueDate,
      openingBalance,
      savingsBalance,
      selectedAccount,
      summaryOpeningBalance,
      totalExpenses,
      totalIncome,
      transactions.length,
    ],
  );

  // ── Selection logic ──
  const visibleIds = visibleTransactions.map((t) => t.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleIds));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkEdit = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (bulkEditStatus === "paid" && bulkEditIncludesCreditCardPurchases) {
      toast({
        title: "Usa Pago TC para liquidar compras con tarjeta",
        description: "La edición masiva no puede marcar compras con tarjeta como pagadas. Registra un Pago TC separado.",
        variant: "destructive",
      });
      return;
    }

    const updateData: Record<string, string> = {};
    if (bulkEditCategory !== "__keep__") updateData.category = bulkEditCategory;
    if (bulkEditWorkspace !== "__keep__") updateData.workspace = bulkEditWorkspace;
    if (bulkEditStatus !== "__keep__") updateData.status = bulkEditStatus;

    if (Object.keys(updateData).length === 0) {
      toast({
        title: "Sin cambios",
        description: "Elige al menos un campo para actualizar.",
        variant: "destructive",
      });
      return;
    }

    await Promise.all(ids.map((id) => updateMutation.mutateAsync({ id, data: updateData })));
    setSelectedIds(new Set());
    setShowBulkEditDialog(false);
    setBulkEditCategory("__keep__");
    setBulkEditWorkspace("__keep__");
    setBulkEditStatus("__keep__");
    toast({ title: `${ids.length} transacciones actualizadas` });
  };

  // ── Form handlers ──
  const handleCreate = (formData: {
    categoryId: string;
    itemId: string;
    amount: string;
    date: string;
    subtype: "actual" | "planned";
    status: "pending" | "paid" | "cancelled";
    workspace: "business" | "family" | "dentist";
    movementType: "income" | "expense" | "transfer" | "credit_card_payment";
    paymentMethod: "cash" | "bank_account" | "credit_card";
    accountId: string;
    destinationWorkspace: "business" | "family" | "dentist";
    creditCardName: string;
    installmentCount: string;
    notes: string;
  }) => {
    const selectedCategory = formData.categoryId ? categoryMap[formData.categoryId] : null;
    const selectedItem = formData.itemId ? itemMap[formData.itemId] : null;
    const derivedName =
      formData.movementType === "transfer"
        ? `Transferencia ${workspaceLabel(formData.workspace)} -> ${workspaceLabel(formData.destinationWorkspace)}`
        : formData.movementType === "credit_card_payment"
        ? `Pago ${formData.creditCardName || "Tarjeta"}`
        : selectedItem?.name ?? selectedCategory?.name ?? "";
    const derivedCategory =
      formData.movementType === "transfer"
        ? "Transferencias"
        : formData.movementType === "credit_card_payment"
        ? "Pago Tarjeta"
        : selectedCategory?.name ?? "";
    if (!derivedName || !derivedCategory) {
      toast({
        title: "Faltan datos para crear la transacción",
        description: "Revisa categoría, subcategoría o tipo de movimiento.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(
      {
        name: derivedName,
        category: derivedCategory,
        amount: parseFloat(formData.amount),
        type: formData.movementType === "income" ? "income" : "expense",
        date: formData.date,
        notes: formData.notes || null,
        subtype: formData.subtype,
        status: formData.status,
        itemId: formData.itemId || null,
        workspace: formData.workspace,
        movementType: formData.movementType,
        paymentMethod: formData.paymentMethod,
        accountId: formData.paymentMethod === "bank_account" && formData.movementType !== "transfer"
          ? formData.accountId || null
          : null,
        destinationWorkspace: formData.movementType === "transfer" ? formData.destinationWorkspace : null,
        creditCardName: formData.paymentMethod === "credit_card" || formData.movementType === "credit_card_payment"
          ? formData.creditCardName || null
          : null,
        installmentCount: formData.paymentMethod === "credit_card" && formData.movementType === "expense"
          ? Number.parseInt(formData.installmentCount || "1", 10)
          : null,
      },
      {
        onSuccess: () => toast({ title: "Transacción creada" }),
      }
    );
  };

  const handleCreateInternalMovement = (formData: {
    movementType: "transfer" | "credit_card_payment";
    sourceAccountId: string;
    destinationAccountId: string;
    destinationCardName: string;
    amount: string;
    date: string;
    notes: string;
  }) => {
    const sourceAccount = accounts.find((account) => account.id === formData.sourceAccountId);
    if (!sourceAccount) {
      toast({
        title: "Cuenta origen no encontrada",
        variant: "destructive",
      });
      return;
    }

    const destinationAccount = formData.movementType === "transfer"
      ? accounts.find((account) => account.id === formData.destinationAccountId)
      : null;

    const destinationLabel = formData.movementType === "transfer"
      ? (destinationAccount ? accountDisplayName(destinationAccount) : "")
      : formData.destinationCardName.trim();

    if (!destinationLabel) {
      toast({
        title: "Falta el destino",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate(
      {
        name: formData.movementType === "transfer" ? `Transferencia a ${destinationLabel}` : `Pago tarjeta ${destinationLabel}`,
        category: formData.movementType === "transfer" ? "Transferencia" : "Pago tarjeta",
        amount: Number(formData.amount),
        type: "expense",
        date: formData.date,
        notes: formData.notes || null,
        subtype: "actual",
        status: "paid",
        itemId: null,
        workspace: accountWorkspaceLabel(sourceAccount.workspace),
        movementType: formData.movementType,
        paymentMethod: "bank_account",
        accountId: sourceAccount.id,
        destinationWorkspace: destinationLabel,
        creditCardName: formData.movementType === "credit_card_payment" ? destinationLabel : null,
        installmentCount: null,
      },
      {
        onSuccess: () => toast({ title: "Movimiento interno creado" }),
      },
    );
  };

  const handleEdit = (formData: {
    categoryId: string;
    itemId: string;
    amount: string;
    date: string;
    subtype: "actual" | "planned";
    status: "pending" | "paid" | "cancelled";
    workspace: "business" | "family" | "dentist";
    movementType: "income" | "expense" | "transfer" | "credit_card_payment";
    paymentMethod: "cash" | "bank_account" | "credit_card";
    accountId: string;
    destinationWorkspace: "business" | "family" | "dentist";
    creditCardName: string;
    installmentCount: string;
    notes: string;
  }) => {
    if (!editingTx) return;
    const selectedCategory = formData.categoryId ? categoryMap[formData.categoryId] : null;
    const selectedItem = formData.itemId ? itemMap[formData.itemId] : null;
    const derivedName =
      formData.movementType === "transfer"
        ? `Transferencia ${workspaceLabel(formData.workspace)} -> ${workspaceLabel(formData.destinationWorkspace)}`
        : formData.movementType === "credit_card_payment"
        ? `Pago ${formData.creditCardName || "Tarjeta"}`
        : selectedItem?.name ?? selectedCategory?.name ?? "";
    const derivedCategory =
      formData.movementType === "transfer"
        ? "Transferencias"
        : formData.movementType === "credit_card_payment"
        ? "Pago Tarjeta"
        : selectedCategory?.name ?? "";
    updateMutation.mutate(
      {
        id: editingTx.id,
        data: {
          name: derivedName,
          category: derivedCategory,
          amount: parseFloat(formData.amount),
          type: formData.movementType === "income" ? "income" : "expense",
          date: formData.date,
          notes: formData.notes || null,
          subtype: formData.subtype,
          status: formData.status,
          itemId: formData.itemId || null,
          workspace: formData.workspace,
          movementType: formData.movementType,
          paymentMethod: formData.paymentMethod,
          accountId: formData.paymentMethod === "bank_account" && formData.movementType !== "transfer"
            ? formData.accountId || null
            : null,
          destinationWorkspace: formData.movementType === "transfer" ? formData.destinationWorkspace : null,
          creditCardName: formData.paymentMethod === "credit_card" || formData.movementType === "credit_card_payment"
            ? formData.creditCardName || null
            : null,
          installmentCount: formData.paymentMethod === "credit_card" && formData.movementType === "expense"
            ? Number.parseInt(formData.installmentCount || "1", 10)
            : null,
        },
      },
      {
        onSuccess: () => {
          setEditingTx(null);
          toast({ title: "Transacción actualizada" });
        },
      }
    );
  };

  // Resolve a transaction to initial form values for editing
  const getEditValues = (tx: Transaction) => {
    const normalized = normalizeTransaction(tx);
    const catId = categoryNameToId[tx.category] ?? "";
    const itmId = tx.itemId ?? "";
    return {
      categoryId: catId,
      itemId: itmId,
      amount: String(tx.amount),
      date: tx.date,
      subtype: tx.subtype as "actual" | "planned",
      status: tx.status as "pending" | "paid" | "cancelled",
      workspace: normalized.workspace,
      movementType: normalized.movementType,
      paymentMethod: normalized.paymentMethod,
      accountId: tx.accountId ?? "",
      destinationWorkspace: normalized.destinationWorkspace ?? (normalized.workspace === "business" ? "family" : "business"),
      creditCardName: normalized.creditCardName ?? "",
      installmentCount: String((tx.installmentCount ?? 1)),
      notes: tx.notes ?? "",
    };
  };

  const toggleHiddenCard = (cardId: DashboardCardId) => {
    setDraftHiddenCards((current) =>
      current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId],
    );
  };

  const handleCardDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const oldIndex = draftCardOrder.indexOf(active.id as DashboardCardId);
    const newIndex = draftCardOrder.indexOf(over.id as DashboardCardId);
    if (oldIndex === -1 || newIndex === -1) return;

    setDraftCardOrder((current) => arrayMove(current, oldIndex, newIndex));
  };

  const handleStartConfig = () => {
    setDraftCardOrder(normalizedDashboardPreferences.cardOrder);
    setDraftHiddenCards(normalizedDashboardPreferences.hiddenCards);
    setIsConfigMode(true);
  };

  const handleCancelConfig = () => {
    setDraftCardOrder(normalizedDashboardPreferences.cardOrder);
    setDraftHiddenCards(normalizedDashboardPreferences.hiddenCards);
    setIsConfigMode(false);
  };

  const handleSaveConfig = async () => {
    await updateDashboardPreferencesMutation.mutateAsync({
      cardOrder: draftCardOrder,
      hiddenCards: draftHiddenCards,
    });
    toast({ title: "Resumen actualizado" });
    setIsConfigMode(false);
  };

  if (txLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Resumen</h2>
        {isConfigMode ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={handleCancelConfig}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSaveConfig}
              disabled={updateDashboardPreferencesMutation.isPending}
            >
              <Save className="size-4" />
              {updateDashboardPreferencesMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={handleStartConfig}>
            <Settings2 className="size-4" />
            Configurar
          </Button>
        )}
      </div>

      {isConfigMode ? (
        <p className="text-sm text-muted-foreground">
          Arrastra las tarjetas para reordenarlas y usa el ojo para ocultarlas o volver a mostrarlas.
        </p>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCardDragEnd}>
        <SortableContext items={activeCardOrder} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {activeCardOrder
              .filter((cardId) => isConfigMode || !activeHiddenCards.includes(cardId))
              .map((cardId) => {
                const card = dashboardCards[cardId];
                return (
                  <div key={cardId} className={card.className}>
                    <SortableDashboardCard
                      id={cardId}
                      hidden={activeHiddenCards.includes(cardId)}
                      isConfigMode={isConfigMode}
                      onToggleHidden={toggleHiddenCard}
                    >
                      {card.content}
                    </SortableDashboardCard>
                  </div>
                );
              })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            Ingresos vs Gastos Mensuales
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72" data-testid="chart-monthly">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value: number) => formatCLP(value)}
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "13px",
                  }}
                />
                <Legend />
                <Bar
                  dataKey="ingresos"
                  name="Ingresos"
                  fill="hsl(var(--chart-1))"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="gastos"
                  name="Gastos"
                  fill="hsl(var(--chart-3))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Create Transaction Form */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Plus className="size-4" />
              Agregar Movimiento
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={createFormMode === "transaction" ? "default" : "outline"}
                size="sm"
                onClick={() => setCreateFormMode("transaction")}
              >
                Transacción
              </Button>
              <Button
                type="button"
                variant={createFormMode === "internal" ? "default" : "outline"}
                size="sm"
                onClick={() => setCreateFormMode("internal")}
              >
                Transferencia
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {createFormMode === "transaction" ? (
            <TransactionForm
              mode="create"
              categories={categories}
              items={items}
              accounts={accounts}
              isPending={createMutation.isPending}
              onSubmit={handleCreate}
            />
          ) : (
            <InternalMovementForm
              accounts={accounts}
              isPending={createMutation.isPending}
              onSubmit={handleCreateInternalMovement}
            />
          )}
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Últimas Transacciones
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="mx-5 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Cuenta</p>
              <Select value={selectedAccountFilter} onValueChange={setSelectedAccountFilter}>
                <SelectTrigger data-testid="select-account-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las cuentas</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {accountDisplayName(account)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedAccountFilter !== "all" && unassignedCurrentMonthTransactions > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {unassignedCurrentMonthTransactions} transacciones sin cuenta asignada
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Desde</p>
              <Input type="date" value={filterFromDate} onChange={(e) => setFilterFromDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Hasta</p>
              <Input type="date" value={filterToDate} onChange={(e) => setFilterToDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Categoría</p>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {transactionCategoryOptions.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setFilterFromDate("");
                  setFilterToDate("");
                  setFilterCategory("all");
                }}
              >
                Limpiar filtros
              </Button>
            </div>
          </div>

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="mx-5 mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5" data-testid="bulk-action-bar">
              <span className="text-sm font-medium text-primary">
                {selectedIds.size} transacci{selectedIds.size === 1 ? "ón" : "ones"} seleccionada{selectedIds.size === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setSelectedIds(new Set())}
                  data-testid="button-clear-selection"
                >
                  Limpiar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowBulkEditDialog(true)}
                >
                  <Pencil className="size-3.5" />
                  Editar seleccionadas
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowDeleteDialog(true)}
                  data-testid="button-bulk-delete"
                >
                  <Trash2 className="size-3.5" />
                  Eliminar seleccionadas
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table className="zebra-stripe" data-testid="table-transactions">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5 w-10">
                    <Checkbox
                      checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                      onCheckedChange={toggleSelectAll}
                      data-testid="checkbox-select-all"
                      aria-label="Seleccionar todas"
                    />
                  </TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Ámbito</TableHead>
                  <TableHead>Pago</TableHead>
                  <TableHead>Ejecutado/Presup.</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right pr-5">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTransactions.map((tx) => (
                  <TableRow
                    key={tx.id}
                    data-testid={`row-transaction-${tx.id}`}
                    className={selectedIds.has(tx.id) ? "bg-primary/5" : undefined}
                  >
                    {(() => {
                      const normalized = normalizeTransaction(tx);
                      return (
                        <>
                    <TableCell className="pl-5">
                      <Checkbox
                        checked={selectedIds.has(tx.id)}
                        onCheckedChange={() => toggleSelect(tx.id)}
                        data-testid={`checkbox-${tx.id}`}
                        aria-label={`Seleccionar ${tx.name}`}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {formatDate(tx.date)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {tx.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {tx.category}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {workspaceLabel(normalized.workspace)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant="outline" className="text-xs">
                          {normalized.movementType === "transfer"
                            ? "Transfer."
                            : normalized.movementType === "credit_card_payment"
                            ? "Pago TC"
                            : normalized.paymentMethod === "credit_card"
                            ? `TC${normalized.creditCardName ? `: ${normalized.creditCardName}` : ""}`
                            : normalized.paymentMethod === "cash"
                            ? "Efectivo"
                            : "Banco"}
                        </Badge>
                        {(() => {
                          const sourceAccount = normalized.accountId ? accountById.get(normalized.accountId) : null;
                          const sourceLabel = sourceAccount ? accountDisplayName(sourceAccount) : "Sin cuenta origen vinculada";

                          if (
                            normalized.movementType === "credit_card_payment"
                          ) {
                            return (
                              <div className="text-[11px] text-muted-foreground">
                                {sourceLabel}
                                {normalized.creditCardName ? ` -> ${normalized.creditCardName}` : ""}
                              </div>
                            );
                          }

                          if (
                            normalized.movementType === "transfer"
                          ) {
                            return (
                              <div className="text-[11px] text-muted-foreground">
                                {sourceLabel}
                                {normalized.destinationWorkspace ? ` -> ${normalized.destinationWorkspace}` : ""}
                              </div>
                            );
                          }

                          return null;
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>
                      {normalized.movementType === "transfer" ? (
                        <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 dark:border-blue-900/40 dark:text-blue-300">
                          Transferencia
                        </Badge>
                      ) : normalized.movementType === "credit_card_payment" ? (
                        <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 dark:border-amber-900/40 dark:text-amber-300">
                          Pago TC
                        </Badge>
                      ) : (
                        <Badge
                          variant={tx.subtype === "planned" ? "outline" : "secondary"}
                          className="text-xs"
                        >
                          {tx.subtype === "planned" ? "Presupuestado" : "Ejecutado"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${
                          tx.status === "paid"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : tx.status === "pending"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {tx.status === "paid" ? "Pagado" : tx.status === "pending" ? "Pendiente" : "Cancelado"}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums text-sm font-medium ${
                        tx.type === "income"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {tx.type === "income" ? "+" : "-"}
                      {formatCLP(tx.amount)}
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      <div className="flex items-center justify-end gap-0.5">
                        {tx.subtype === "planned" && tx.status === "pending" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() =>
                              setPayDialog({
                              tx,
                              amount: String(tx.amount),
                              paymentMethod: "bank_account",
                              accountId: tx.accountId ?? "",
                              creditCardName: normalized.creditCardName ?? "",
                              installmentCount: String(tx.installmentCount ?? 1),
                            })
                          }
                            data-testid={`button-pay-${tx.id}`}
                          >
                            Pagar
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setEditingTx(tx)}
                          data-testid={`button-edit-${tx.id}`}
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => deleteMutation.mutate(tx.id)}
                          data-testid={`button-delete-${tx.id}`}
                        >
                          <Trash2 className="size-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                        </>
                      );
                    })()}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar transacciones</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Estás seguro de que quieres eliminar{" "}
              <span className="font-semibold text-foreground">{selectedIds.size}</span>{" "}
              transacci{selectedIds.size === 1 ? "ón" : "ones"}? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                bulkDeleteMutation.mutate(Array.from(selectedIds), {
                  onSuccess: (data) => {
                    setSelectedIds(new Set());
                    setShowDeleteDialog(false);
                    toast({ title: `${data.deleted} transacciones eliminadas` });
                  },
                })
              }
              disabled={bulkDeleteMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending ? "Eliminando..." : `Eliminar ${selectedIds.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Transaction Modal */}
      <Dialog open={!!editingTx} onOpenChange={(open) => { if (!open) setEditingTx(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Editar Transacción</DialogTitle>
            <DialogDescription>
              Modifica los campos y guarda los cambios.
            </DialogDescription>
          </DialogHeader>
          {editingTx && (
            <TransactionForm
              key={editingTx.id}
              mode="edit"
              categories={categories}
              items={items}
              accounts={accounts}
              initialValues={getEditValues(editingTx)}
              isPending={updateMutation.isPending}
              onSubmit={handleEdit}
              onCancel={() => setEditingTx(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkEditDialog} onOpenChange={setShowBulkEditDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar transacciones seleccionadas</DialogTitle>
            <DialogDescription>
              Aplica cambios masivos a las transacciones seleccionadas. Los campos en “No cambiar” se mantienen igual.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">Categoría</p>
              <Select value={bulkEditCategory} onValueChange={setBulkEditCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep__">No cambiar</SelectItem>
                  {transactionCategoryOptions.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">Ámbito</p>
                <Select value={bulkEditWorkspace} onValueChange={setBulkEditWorkspace}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__keep__">No cambiar</SelectItem>
                    <SelectItem value="business">Empresa</SelectItem>
                    <SelectItem value="family">Familia</SelectItem>
                    <SelectItem value="dentist">Consulta Dentista</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">Estado</p>
                <Select value={bulkEditStatus} onValueChange={setBulkEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__keep__">No cambiar</SelectItem>
                    <SelectItem value="pending">Pendiente</SelectItem>
                    <SelectItem value="paid">Pagado</SelectItem>
                    <SelectItem value="cancelled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
                {bulkEditIncludesCreditCardPurchases ? (
                  <p className="text-[11px] text-muted-foreground">
                    Las compras con tarjeta se liquidan mediante un Pago TC, no marcándolas como pagadas en lote.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowBulkEditDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleBulkEdit} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Guardando..." : `Actualizar ${selectedIds.size}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payDialog} onOpenChange={(open) => { if (!open) setPayDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar pagado</DialogTitle>
            <DialogDescription>
              Confirma el pago y el método usado para convertir este compromiso en una transacción pagada.
            </DialogDescription>
          </DialogHeader>
          {payDialog ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">{payDialog.tx.name}</p>
                <p className="text-xs text-muted-foreground">
                  {payDialog.tx.category} · {formatDate(payDialog.tx.date)}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Monto</p>
                <Input
                  type="number"
                  value={payDialog.amount}
                  onChange={(e) =>
                    setPayDialog((current) => (current ? { ...current, amount: e.target.value } : current))
                  }
                  data-testid="input-pay-amount"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Método de pago</p>
                <Select
                  value={payDialog.paymentMethod}
                  onValueChange={(value) =>
                    setPayDialog((current) =>
                      current
                        ? {
                            ...current,
                            paymentMethod: value as "cash" | "bank_account" | "credit_card",
                            accountId: value === "bank_account" ? current.accountId : "",
                            creditCardName: value === "credit_card" ? current.creditCardName : "",
                            installmentCount: value === "credit_card" ? current.installmentCount || "1" : "1",
                          }
                        : current,
                    )
                  }
                >
                  <SelectTrigger data-testid="select-pay-payment-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_account">Banco</SelectItem>
                    <SelectItem value="credit_card">Tarjeta de crédito</SelectItem>
                    <SelectItem value="cash">Efectivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {payDialog.paymentMethod === "bank_account" ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Cuenta</p>
                  <Select
                    value={payDialog.accountId}
                    onValueChange={(value) =>
                      setPayDialog((current) => (current ? { ...current, accountId: value } : current))
                    }
                  >
                    <SelectTrigger data-testid="select-pay-account">
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
              ) : null}
              {payDialog.paymentMethod === "credit_card" ? (
                <>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Tarjeta</p>
                    {creditCards.length > 0 ? (
                      <Select
                        value={payDialog.creditCardName}
                        onValueChange={(value) =>
                          setPayDialog((current) => (current ? { ...current, creditCardName: value } : current))
                        }
                      >
                        <SelectTrigger data-testid="select-pay-credit-card">
                          <SelectValue placeholder="Seleccionar tarjeta" />
                        </SelectTrigger>
                        <SelectContent>
                          {creditCards.map((card) => (
                            <SelectItem key={card} value={card}>
                              {card}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={payDialog.creditCardName}
                        onChange={(e) =>
                          setPayDialog((current) => (current ? { ...current, creditCardName: e.target.value } : current))
                        }
                        placeholder="Nombre tarjeta"
                        data-testid="input-pay-credit-card-name"
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Número de cuotas</p>
                    <Input
                      type="number"
                      min="1"
                      value={payDialog.installmentCount}
                      onChange={(e) =>
                        setPayDialog((current) => {
                          if (!current) return current;
                          const raw = e.target.value;
                          const parsed = Number(raw);
                          return {
                            ...current,
                            installmentCount: !raw || !Number.isFinite(parsed) || parsed < 1 ? "1" : String(Math.floor(parsed)),
                          };
                        })
                      }
                      data-testid="input-pay-installment-count"
                    />
                  </div>
                  {Number(payDialog.installmentCount || "1") > 1 ? (
                    <p className="text-xs text-muted-foreground">
                      Cuota mensual:{" "}
                      <span className="font-medium">
                        {formatCLP(
                          Number(payDialog.amount || 0) / Number(payDialog.installmentCount || "1"),
                        )}
                      </span>
                    </p>
                  ) : null}
                </>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPayDialog(null)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => {
                    if (!payDialog) return;
                    if (payDialog.paymentMethod === "credit_card" && !payDialog.creditCardName.trim()) {
                      toast({
                        title: "Falta la tarjeta",
                        description: "Selecciona o escribe la tarjeta de crédito usada para pagar.",
                        variant: "destructive",
                      });
                      return;
                    }
                    updateMutation.mutate(
                      {
                        id: payDialog.tx.id,
                        data: {
                          amount: Number(payDialog.amount || payDialog.tx.amount),
                          status: "paid",
                          subtype: "actual",
                          paymentMethod: payDialog.paymentMethod,
                          accountId: payDialog.paymentMethod === "bank_account"
                            ? payDialog.accountId || null
                            : null,
                          creditCardName: payDialog.paymentMethod === "credit_card"
                            ? payDialog.creditCardName || null
                            : null,
                          installmentCount: payDialog.paymentMethod === "credit_card" && Number(payDialog.installmentCount || "1") > 1
                            ? Number(payDialog.installmentCount || "1")
                            : null,
                        },
                      },
                      {
                        onSuccess: () => {
                          setPayDialog(null);
                          toast({ title: "Transacción marcada como pagada" });
                        },
                      },
                    );
                  }}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? "Guardando..." : "Confirmar pago"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
