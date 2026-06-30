import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banknote, Camera, CreditCard, Loader2, ReceiptText, Sparkles, Upload, Wallet } from "lucide-react";
import { useLocation } from "wouter";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useAccounts,
  useCategories,
  useCreateTransaction,
  useCreditCardSettings,
  useItems,
} from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { getCreditCards } from "@/lib/credit-cards";
import { extractReceiptFromImage, type ReceiptOcrResult } from "@/lib/receipt-ocr";
import type { Workspace } from "@/lib/finance";
import {
  buildQuickExpenseTransaction,
  inferQuickExpenseCategoryId,
  type QuickExpensePaymentMethod,
} from "@/domain/quick-expense";
import { categoryMatchesWorkspace } from "@/domain/categories";
import {
  FinanceDialogBody,
  FinanceDialogContent,
  FinanceDialogFooter,
  FinanceDialogHeader,
  FinanceSegmentedControl,
} from "@/components/finance/finance-dialog";

type QuickExpenseForm = {
  name: string;
  categoryId: string;
  itemId: string;
  amount: string;
  date: string;
  workspace: Workspace;
  paymentMethod: QuickExpensePaymentMethod;
  accountId: string;
  creditCardName: string;
  installmentCount: string;
  notes: string;
};

const paymentMethodOptions: Array<{ value: QuickExpensePaymentMethod; label: string }> = [
  { value: "credit_card", label: "Tarjeta" },
  { value: "bank_account", label: "Cuenta" },
  { value: "cash", label: "Efectivo" },
];

const workspaceOptions: Array<{ value: Workspace; label: string }> = [
  { value: "family", label: "Familia" },
  { value: "business", label: "Empresa" },
  { value: "dentist", label: "Consulta" },
];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildDefaultForm(cardNames: string[], defaultAccountId = ""): QuickExpenseForm {
  return {
    name: "",
    categoryId: "",
    itemId: "",
    amount: "",
    date: todayDate(),
    workspace: "family",
    paymentMethod: cardNames.length > 0 ? "credit_card" : "bank_account",
    accountId: defaultAccountId,
    creditCardName: cardNames[0] ?? "",
    installmentCount: "1",
    notes: "",
  };
}

function formatConfidence(value: number) {
  if (!value) return "";
  return `${Math.round(value * 100)}%`;
}

function isSupportedCardSource(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function QuickExpenseCapture() {
  const [location] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<QuickExpenseForm>(() => buildDefaultForm([]));
  const [ocrResult, setOcrResult] = useState<ReceiptOcrResult | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrPending, setOcrPending] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const { data: categories = [] } = useCategories();
  const { data: items = [] } = useItems();
  const { data: accounts = [] } = useAccounts();
  const { data: creditCardSettings = [] } = useCreditCardSettings();
  const createTransactionMutation = useCreateTransaction();
  const [localCards, setLocalCards] = useState<string[]>([]);

  const bankAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        const isBankType = account.type === "checking" || account.type === "savings";
        const isActive = (account as { isActive?: boolean }).isActive ?? true;
        return isBankType && isActive;
      }),
    [accounts],
  );

  const creditCardAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        const isActive = (account as { isActive?: boolean }).isActive ?? true;
        return account.type === "credit_card" && isActive;
      }),
    [accounts],
  );

  const cardNames = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...localCards,
            ...creditCardSettings
              .filter((setting) => setting.isActive !== false)
              .map((setting) => setting.cardName),
            ...accounts
              .filter((account) => account.type === "credit_card")
              .map((account) => account.name),
          ]
            .filter(isSupportedCardSource)
            .map((card) => card.trim()),
        ),
      ).sort((left, right) => left.localeCompare(right, "es")),
    [accounts, creditCardSettings, localCards],
  );

  const expenseCategories = useMemo(
    () =>
      categories.filter(
        (category) => category.type === "expense" && categoryMatchesWorkspace(category, form.workspace),
      ),
    [categories, form.workspace],
  );

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === form.categoryId) ?? null,
    [categories, form.categoryId],
  );

  const itemOptions = useMemo(
    () => items.filter((item) => item.categoryId === form.categoryId),
    [form.categoryId, items],
  );

  const selectedItem = useMemo(
    () => items.find((item) => item.id === form.itemId) ?? null,
    [form.itemId, items],
  );

  const defaultAccountId = useMemo(() => {
    const familyAccount = bankAccounts.find((account) => account.workspace === "family");
    return familyAccount?.id ?? bankAccounts[0]?.id ?? "";
  }, [bankAccounts]);

  const resetCapture = useCallback(() => {
    setForm(buildDefaultForm(cardNames, defaultAccountId));
    setOcrResult(null);
    setOcrError(null);
    setImagePreview(null);
  }, [cardNames, defaultAccountId]);

  const openCapture = useCallback(() => {
    resetCapture();
    setOpen(true);
  }, [resetCapture]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncCards = () => setLocalCards(getCreditCards());
    syncCards();
    window.addEventListener("octopus-credit-cards-updated", syncCards);
    return () => window.removeEventListener("octopus-credit-cards-updated", syncCards);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const openFromEvent = () => openCapture();
    window.addEventListener("octopus-quick-expense-open", openFromEvent);
    return () => window.removeEventListener("octopus-quick-expense-open", openFromEvent);
  }, [openCapture]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "g" || !event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true;
      if (editable) return;
      event.preventDefault();
      openCapture();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openCapture]);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const updateForm = <Key extends keyof QuickExpenseForm>(key: Key, value: QuickExpenseForm[Key]) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "categoryId") {
        next.itemId = "";
      }
      if (key === "paymentMethod" && value !== "credit_card") {
        next.installmentCount = "1";
      }
      if (key === "paymentMethod" && value === "cash") {
        next.accountId = "";
      }
      if (key === "paymentMethod" && value === "credit_card" && !next.creditCardName) {
        next.creditCardName = cardNames[0] ?? "";
      }
      if (key === "paymentMethod" && value === "bank_account" && !next.accountId) {
        next.accountId = defaultAccountId;
      }
      return next;
    });
  };

  const applyOcrResult = (result: ReceiptOcrResult) => {
    const suggestedCategoryId = inferQuickExpenseCategoryId(categories, [
      result.categoryHint,
      result.merchantName,
      result.description,
    ]);
    const ocrNote = [
      "OCR voucher",
      result.confidence ? `confianza ${formatConfidence(result.confidence)}` : "",
      result.warnings.length ? `alertas: ${result.warnings.join("; ")}` : "",
    ].filter(Boolean).join(" · ");

    setForm((current) => {
      const paymentMethod = result.paymentMethod === "unknown" ? current.paymentMethod : result.paymentMethod;
      return {
        ...current,
        name: result.merchantName ?? result.description ?? current.name,
        categoryId: suggestedCategoryId || current.categoryId,
        itemId: suggestedCategoryId && suggestedCategoryId !== current.categoryId ? "" : current.itemId,
        amount: result.totalAmount ? String(result.totalAmount) : current.amount,
        date: result.date ?? current.date,
        paymentMethod,
        accountId: paymentMethod === "cash" ? "" : current.accountId || defaultAccountId,
        creditCardName: result.creditCardName ?? current.creditCardName,
        installmentCount: result.installmentCount ? String(result.installmentCount) : current.installmentCount,
        notes: current.notes || ocrNote,
      };
    });
  };

  const handleImageSelected = async (file: File | null) => {
    if (!file) return;
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(URL.createObjectURL(file));
    setOcrError(null);
    setOcrResult(null);

    try {
      setOcrPending(true);
      const result = await extractReceiptFromImage(file);
      setOcrResult(result);
      applyOcrResult(result);
      toast({
        title: "Voucher leído",
        description: result.confidence ? `Confianza ${formatConfidence(result.confidence)}. Revisa antes de guardar.` : "Revisa antes de guardar.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo leer el voucher.";
      setOcrError(message);
      toast({
        title: "OCR no disponible",
        description: "Puedes registrar el gasto manualmente en el mismo formulario.",
        variant: "destructive",
      });
    } finally {
      setOcrPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async () => {
    const amount = Number(form.amount || 0);
    if (!form.name.trim()) {
      toast({ title: "Falta el comercio o descripción", variant: "destructive" });
      return;
    }
    if (!form.categoryId || !selectedCategory) {
      toast({ title: "Selecciona una categoría", variant: "destructive" });
      return;
    }
    if (!form.date || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Completa fecha y monto", variant: "destructive" });
      return;
    }
    if (form.paymentMethod === "bank_account" && !form.accountId) {
      toast({ title: "Selecciona la cuenta de pago", variant: "destructive" });
      return;
    }
    if (form.paymentMethod === "credit_card" && !form.creditCardName.trim()) {
      toast({ title: "Escribe la tarjeta usada", variant: "destructive" });
      return;
    }

    const installmentCount = Number(form.installmentCount || 1);
    const payload = buildQuickExpenseTransaction(
      {
        name: form.name.trim(),
        categoryId: form.categoryId,
        itemId: form.itemId,
        amount,
        date: form.date,
        workspace: form.workspace,
        paymentMethod: form.paymentMethod,
        accountId: form.accountId || null,
        creditCardName: form.creditCardName.trim() || null,
        installmentCount: Number.isFinite(installmentCount) ? Math.max(1, installmentCount) : 1,
        notes: form.notes.trim() || null,
      },
      selectedCategory,
      selectedItem,
    );

    try {
      await createTransactionMutation.mutateAsync(payload);
      toast({
        title: "Gasto registrado",
        description: form.paymentMethod === "credit_card" ? "Quedó pendiente hasta el pago de la tarjeta." : "Quedó como pago ejecutado.",
      });
      setOpen(false);
      resetCapture();
    } catch (error) {
      toast({
        title: "No se pudo guardar",
        description: error instanceof Error ? error.message : "Intenta nuevamente.",
        variant: "destructive",
      });
    }
  };

  const isReading = ocrPending || createTransactionMutation.isPending;
  const quickButtonOffset = "bottom-6 right-6";

  return (
    <>
      <Button
        type="button"
        onClick={openCapture}
        className={cn(
          "!fixed z-[60] hidden size-14 items-center justify-center rounded-full bg-[#cdfa46] p-0 text-[#0a0a0f] shadow-[0_12px_35px_rgba(205,250,70,0.35)] hover:scale-105 hover:bg-[#bdf03a] active:scale-95 no-default-hover-elevate no-default-active-elevate md:inline-flex",
          quickButtonOffset,
        )}
        aria-label="Captura rápida de gasto (foto / OCR)"
        title="Captura rápida de gasto (foto / OCR)"
      >
        <Camera className="size-6" />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetCapture();
        }}
      >
        <FinanceDialogContent size="md">
          <FinanceDialogHeader
            title="Registro rápido de gasto"
            description="Sube un voucher para prellenar o completa solo lo esencial."
            icon={<ReceiptText className="size-4" />}
            actions={
              <div className="hidden rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-[#9a9aa6] sm:block">
                Cmd/Ctrl + Shift + G
              </div>
            }
          />
          <FinanceDialogBody className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-extrabold text-[#f4f4f7]">Foto o pantallazo</p>
                      <p className="mt-1 text-xs text-[#9a9aa6]">JPG, PNG, WEBP o GIF.</p>
                    </div>
                    <Sparkles className="size-4 text-[#cdfa46]" />
                  </div>

                  <div className="mt-4 overflow-hidden rounded-xl border border-dashed border-white/12 bg-[#0a0a0f]">
                    {imagePreview ? (
                      <img src={imagePreview} alt="Voucher seleccionado" className="h-44 w-full object-cover" />
                    ) : (
                      <button
                        type="button"
                        className="flex h-44 w-full flex-col items-center justify-center gap-2 text-[#9a9aa6] transition hover:bg-white/[0.03] hover:text-[#f4f4f7]"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Camera className="size-8" />
                        <span className="text-sm font-bold">Subir voucher</span>
                      </button>
                    )}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(event) => void handleImageSelected(event.target.files?.[0] ?? null)}
                  />

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isReading}
                      className="border-white/12 text-[#f4f4f7]"
                    >
                      {ocrPending ? <Loader2 className="size-4 animate-spin" /> : ocrResult ? <Upload className="size-4" /> : <Camera className="size-4" />}
                      {ocrPending ? "Leyendo" : ocrResult ? "Cambiar imagen" : "Leer voucher"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setOcrResult(null);
                        setOcrError(null);
                        if (imagePreview) URL.revokeObjectURL(imagePreview);
                        setImagePreview(null);
                      }}
                      disabled={isReading || (!imagePreview && !ocrResult && !ocrError)}
                      className="text-[#9a9aa6]"
                    >
                      Limpiar
                    </Button>
                  </div>

                  {ocrResult ? (
                    <div className="mt-3 rounded-lg border border-[#cdfa46]/20 bg-[#cdfa46]/10 p-3 text-xs text-[#cdfa46]">
                      OCR aplicado {formatConfidence(ocrResult.confidence) ? `· ${formatConfidence(ocrResult.confidence)}` : ""}
                      {ocrResult.warnings.length ? (
                        <p className="mt-1 text-[#f5c77a]">{ocrResult.warnings.join(" · ")}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {ocrError ? (
                    <div className="mt-3 rounded-lg border border-[#e3e3ea]/20 bg-[#e3e3ea]/10 p-3 text-xs text-[#f4f4f7]">
                      {ocrError}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Comercio o descripción</Label>
                  <Input
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                    placeholder="Ej: Líder, Copec, Uber Eats"
                    data-testid="quick-expense-name"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Monto</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.amount}
                    onChange={(event) => updateForm("amount", event.target.value)}
                    placeholder="0"
                    data-testid="quick-expense-amount"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Fecha</Label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={(event) => updateForm("date", event.target.value)}
                    data-testid="quick-expense-date"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Ámbito</Label>
                  <Select value={form.workspace} onValueChange={(value) => updateForm("workspace", value as Workspace)}>
                    <SelectTrigger data-testid="quick-expense-workspace">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Categoría</Label>
                  <Select value={form.categoryId || undefined} onValueChange={(value) => updateForm("categoryId", value)}>
                    <SelectTrigger data-testid="quick-expense-category">
                      <SelectValue placeholder="Elegir" />
                    </SelectTrigger>
                    <SelectContent>
                      {expenseCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Subcategoría</Label>
                  <Select
                    value={form.itemId || undefined}
                    onValueChange={(value) => updateForm("itemId", value)}
                    disabled={!form.categoryId || itemOptions.length === 0}
                  >
                    <SelectTrigger data-testid="quick-expense-item">
                      <SelectValue placeholder={form.categoryId ? "Opcional" : "Elige categoría primero"} />
                    </SelectTrigger>
                    <SelectContent>
                      {itemOptions.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Método de pago</Label>
                  <FinanceSegmentedControl
                    value={form.paymentMethod}
                    options={paymentMethodOptions}
                    onChange={(value) => updateForm("paymentMethod", value)}
                  />
                </div>

                {form.paymentMethod === "bank_account" ? (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Cuenta de pago</Label>
                    <Select value={form.accountId || undefined} onValueChange={(value) => updateForm("accountId", value)}>
                      <SelectTrigger data-testid="quick-expense-account">
                        <SelectValue placeholder="Elegir cuenta" />
                      </SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name} · {account.bank}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {form.paymentMethod === "credit_card" ? (
                  <>
                    <div className="space-y-1.5">
                      <Label>Tarjeta</Label>
                      <Select value={form.creditCardName || undefined} onValueChange={(value) => updateForm("creditCardName", value)}>
                        <SelectTrigger data-testid="quick-expense-card">
                          <SelectValue placeholder="Elegir tarjeta" />
                        </SelectTrigger>
                        <SelectContent>
                          {creditCardAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.name}>
                              {account.name} · {account.bank}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cuotas</Label>
                      <Input
                        type="number"
                        min="1"
                        value={form.installmentCount}
                        onChange={(event) => updateForm("installmentCount", event.target.value)}
                        data-testid="quick-expense-installments"
                      />
                    </div>
                  </>
                ) : null}

                {form.paymentMethod === "cash" ? (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-[#9a9aa6] sm:col-span-2">
                    <Wallet className="mr-2 inline size-4 text-[#cdfa46]" />
                    El gasto quedará pagado sin afectar una cuenta bancaria.
                  </div>
                ) : null}

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Notas</Label>
                  <Textarea
                    value={form.notes}
                    onChange={(event) => updateForm("notes", event.target.value)}
                    placeholder="Opcional"
                    className="min-h-20"
                    data-testid="quick-expense-notes"
                  />
                </div>
              </div>
            </div>
          </FinanceDialogBody>
          <FinanceDialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isReading}>
              Cancelar
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={isReading} data-testid="quick-expense-submit">
              {createTransactionMutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Guardando
                </>
              ) : (
                <>
                  {form.paymentMethod === "credit_card" ? <CreditCard className="size-4" /> : <Banknote className="size-4" />}
                  Registrar gasto
                </>
              )}
            </Button>
          </FinanceDialogFooter>
        </FinanceDialogContent>
      </Dialog>
    </>
  );
}
