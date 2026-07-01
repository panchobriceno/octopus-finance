import { useMemo, useState } from "react";
import { Pencil, Plus, Tags, Trash2, TriangleAlert } from "lucide-react";
import type { Category, Item, MovementRule } from "@shared/schema";
import {
  useCreateMovementRule,
  useDeleteMovementRule,
  useMovementRules,
  useUpdateMovementRule,
} from "@/lib/hooks";
import {
  categoryTypeForMovementType,
  isRuleItemConsistent,
  itemsForRuleCategory,
  parseRuleKeywords,
  sanitizeRuleItemId,
} from "@/domain/movement-rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog } from "@/components/ui/dialog";
import {
  FinanceDialogBody,
  FinanceDialogContent,
  FinanceDialogFooter,
  FinanceDialogHeader,
} from "@/components/finance/finance-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// Ámbitos que el editor ofrece. Deliberadamente NO incluye "shared" (que el
// schema permite) para mantenerse alineado con el flujo de importación, que
// sólo maneja business/family/dentist.
const WORKSPACE_OPTIONS = [
  { value: "business", label: "Empresa" },
  { value: "family", label: "Familia" },
  { value: "dentist", label: "Consulta Dentista" },
] as const;

const MOVEMENT_TYPE_OPTIONS = [
  { value: "expense", label: "Gasto" },
  { value: "income", label: "Ingreso" },
  { value: "transfer", label: "Transferencia" },
  { value: "credit_card_payment", label: "Pago de tarjeta" },
] as const;

const AMOUNT_DIRECTION_OPTIONS = [
  { value: "any", label: "Cualquiera" },
  { value: "expense", label: "Solo egresos" },
  { value: "income", label: "Solo ingresos" },
] as const;

const PAYMENT_METHOD_OPTIONS = [
  { value: "bank_account", label: "Cuenta bancaria" },
  { value: "credit_card", label: "Tarjeta de crédito" },
  { value: "cash", label: "Efectivo" },
] as const;

const NO_ITEM = "__none__";

interface RuleFormState {
  name: string;
  keywordsText: string;
  category: string;
  movementType: string;
  amountDirection: string;
  paymentMethod: string;
  workspace: string;
  itemId: string | null;
  amountMin: string;
  amountMax: string;
  priority: string;
  isActive: boolean;
  notes: string;
}

/** Parsea un campo de monto: "" → null; inválido/negativo → símbolo de error (NaN). */
function parseAmountField(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return Number.NaN; // NaN = inválido, lo caza handleSubmit
  return n;
}

function emptyForm(): RuleFormState {
  return {
    name: "",
    keywordsText: "",
    category: "",
    movementType: "expense",
    amountDirection: "any",
    paymentMethod: "bank_account",
    workspace: "family",
    itemId: null,
    amountMin: "",
    amountMax: "",
    priority: "0",
    isActive: true,
    notes: "",
  };
}

function ruleToForm(rule: MovementRule): RuleFormState {
  return {
    name: rule.name ?? "",
    keywordsText: (rule.keywords ?? []).join(", "),
    category: rule.category ?? "",
    movementType: rule.movementType ?? "expense",
    amountDirection: rule.amountDirection ?? "any",
    paymentMethod: rule.paymentMethod ?? "bank_account",
    workspace: rule.workspace ?? "family",
    itemId: rule.itemId ?? null,
    amountMin: rule.amountMin != null ? String(rule.amountMin) : "",
    amountMax: rule.amountMax != null ? String(rule.amountMax) : "",
    priority: String(rule.priority ?? 0),
    isActive: rule.isActive !== false,
    notes: rule.notes ?? "",
  };
}

export function MovementRulesEditor({
  categories,
  items,
}: {
  categories: Category[];
  items: Item[];
}) {
  const { toast } = useToast();
  // Query interna: comparte cache con data-health (misma queryKey "movement-rules"),
  // así que no hay doble fetch y las mutaciones invalidan para ambos.
  const { data: rules = [], isLoading } = useMovementRules();
  const createRule = useCreateMovementRule();
  const updateRule = useUpdateMovementRule();
  const deleteRule = useDeleteMovementRule();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(emptyForm);
  const [pendingDelete, setPendingDelete] = useState<MovementRule | null>(null);

  const itemsById = useMemo(() => {
    const map = new Map<string, Item>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  // Nombres de categoría disponibles para el tipo derivado del movimiento.
  const categoryNameOptions = useMemo(() => {
    const type = categoryTypeForMovementType(form.movementType);
    const names = new Set<string>();
    for (const category of categories) {
      if (category.type === type && category.name) names.add(category.name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "es"));
  }, [categories, form.movementType]);

  const formItems = useMemo(
    () => itemsForRuleCategory(categories, items, form.category, form.movementType, form.workspace),
    [categories, items, form.category, form.movementType, form.workspace],
  );

  const saving = createRule.isPending || updateRule.isPending;

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(rule: MovementRule) {
    setEditingId(rule.id);
    setForm(ruleToForm(rule));
    setDialogOpen(true);
  }

  function patch(next: Partial<RuleFormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  // Cualquier cambio que altere la resolución de categoría invalida el itemId elegido.
  function handleCategoryChange(category: string) {
    patch({ category, itemId: null });
  }
  function handleMovementTypeChange(movementType: string) {
    const typeChanged =
      categoryTypeForMovementType(movementType) !== categoryTypeForMovementType(form.movementType);
    // Deshacer una dirección de monto que contradiga el nuevo tipo (income vs expense),
    // que dejaría la regla muerta: nunca matchearía ningún movimiento.
    let amountDirection = form.amountDirection;
    if (movementType === "income" && amountDirection === "expense") amountDirection = "any";
    if (movementType === "expense" && amountDirection === "income") amountDirection = "any";
    // Si el lado (ingreso/egreso) cambia, la categoría elegida ya no aplica.
    patch({ movementType, amountDirection, itemId: null, category: typeChanged ? "" : form.category });
  }
  function handleWorkspaceChange(workspace: string) {
    patch({ workspace, itemId: null });
  }

  async function handleSubmit() {
    const name = form.name.trim();
    if (!name) {
      toast({ title: "Falta el nombre", description: "La regla necesita un nombre.", variant: "destructive" });
      return;
    }
    if (!form.category) {
      toast({ title: "Falta la categoría", description: "Elegí a qué categoría asigna la regla.", variant: "destructive" });
      return;
    }
    if (
      (form.movementType === "income" && form.amountDirection === "expense") ||
      (form.movementType === "expense" && form.amountDirection === "income")
    ) {
      toast({
        title: "Tipo y dirección se contradicen",
        description: "El tipo de movimiento y la dirección del monto son opuestos: la regla nunca coincidiría con nada.",
        variant: "destructive",
      });
      return;
    }
    const keywords = parseRuleKeywords(form.keywordsText);
    if (form.isActive && keywords.length === 0) {
      toast({
        title: "Regla activa sin palabras clave",
        description: "Una regla activa necesita al menos una palabra clave; si no, nunca coincide con nada.",
        variant: "destructive",
      });
      return;
    }
    const sanitizedItemId = sanitizeRuleItemId(
      categories,
      items,
      form.category,
      form.movementType,
      form.workspace,
      form.itemId,
    );
    if (form.itemId && !sanitizedItemId) {
      toast({
        title: "Subcategoría limpiada",
        description: "La subcategoría no pertenece a la categoría elegida, así que se guardó sin subcategoría.",
      });
    }
    const amountMin = parseAmountField(form.amountMin);
    const amountMax = parseAmountField(form.amountMax);
    if (Number.isNaN(amountMin) || Number.isNaN(amountMax)) {
      toast({ title: "Monto inválido", description: "El rango de monto debe ser un número no negativo.", variant: "destructive" });
      return;
    }
    if (amountMin != null && amountMax != null && amountMin > amountMax) {
      toast({ title: "Rango de monto al revés", description: "El monto \"desde\" no puede ser mayor que el \"hasta\".", variant: "destructive" });
      return;
    }
    const priority = Number.parseInt(form.priority, 10);
    const data = {
      name,
      keywords,
      category: form.category,
      itemId: sanitizedItemId,
      movementType: form.movementType,
      amountDirection: form.amountDirection,
      paymentMethod: form.paymentMethod,
      workspace: form.workspace,
      amountMin,
      amountMax,
      priority: Number.isFinite(priority) ? priority : 0,
      isActive: form.isActive,
      notes: form.notes.trim() ? form.notes.trim() : null,
    };

    try {
      if (editingId) {
        // Update hace spread de data: NO enviamos accountId/creditCardName/cardAccountId,
        // así que el ruteo de cuenta/tarjeta de reglas legacy se preserva intacto.
        await updateRule.mutateAsync({ id: editingId, data });
        toast({ title: "Regla actualizada", description: name });
      } else {
        await createRule.mutateAsync(data);
        toast({ title: "Regla creada", description: name });
      }
      setDialogOpen(false);
    } catch (error) {
      toast({
        title: "No se pudo guardar",
        description: error instanceof Error ? error.message : "Error desconocido",
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    try {
      await deleteRule.mutateAsync(pendingDelete.id);
      toast({ title: "Regla eliminada", description: pendingDelete.name });
    } catch (error) {
      toast({
        title: "No se pudo eliminar",
        description: error instanceof Error ? error.message : "Error desconocido",
        variant: "destructive",
      });
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <Card className="border-[#cdfa46]/10 bg-card/90">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Tags className="size-4 text-primary" />
              Reglas de categorización
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Palabras clave que auto-asignan categoría y subcategoría a los movimientos al importar.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="rounded-full border-[#cdfa46]/20 bg-[#cdfa46]/10 px-3 py-1">
              {rules.length} {rules.length === 1 ? "regla" : "reglas"}
            </Badge>
            <Button type="button" size="sm" className="gap-1.5 rounded-full" onClick={openCreate}>
              <Plus className="size-4" />
              Nueva regla
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando reglas…</p>
        ) : rules.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Todavía no hay reglas. Creá la primera con "Nueva regla".
          </p>
        ) : (
          rules.map((rule) => {
            const itemName = rule.itemId ? itemsById.get(rule.itemId)?.name ?? null : null;
            const itemBroken =
              Boolean(rule.itemId) &&
              !isRuleItemConsistent(categories, items, rule.category, rule.movementType, rule.workspace, rule.itemId);
            return (
              <div
                key={rule.id}
                className="flex flex-col gap-2 rounded-xl border border-white/5 bg-background/30 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{rule.name}</span>
                    {rule.isActive === false ? (
                      <Badge variant="outline" className="border-white/15 text-[10px] uppercase text-muted-foreground">
                        Inactiva
                      </Badge>
                    ) : null}
                    {itemBroken ? (
                      <Badge variant="outline" className="gap-1 border-amber-500/40 text-[10px] text-amber-400">
                        <TriangleAlert className="size-3" />
                        Subcategoría inválida
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {rule.category}
                    {itemName ? ` › ${itemName}` : ""} · {(rule.keywords ?? []).join(", ") || "sin palabras clave"}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70">
                    {rule.workspace} · prioridad {rule.priority ?? 0}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => openEdit(rule)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-red-400"
                    onClick={() => setPendingDelete(rule)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? null : setDialogOpen(false))}>
        <FinanceDialogContent size="md">
          <FinanceDialogHeader
            title={editingId ? "Editar regla" : "Nueva regla"}
            icon={<Tags className="size-4" />}
            description="La regla busca las palabras clave en la descripción del movimiento y le asigna categoría, subcategoría y ámbito."
          />
          <FinanceDialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input
                value={form.name}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder="Ej: Uber Eats"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Palabras clave</Label>
              <Input
                value={form.keywordsText}
                onChange={(event) => patch({ keywordsText: event.target.value })}
                placeholder="separadas por coma: uber eats, ubereats"
              />
              <p className="text-[11px] text-muted-foreground">
                La regla coincide si la descripción del movimiento contiene alguna de estas palabras.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo de movimiento</Label>
                <Select value={form.movementType} onValueChange={handleMovementTypeChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MOVEMENT_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Ámbito</Label>
                <Select value={form.workspace} onValueChange={handleWorkspaceChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WORKSPACE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select value={form.category || undefined} onValueChange={handleCategoryChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Elegí una categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryNameOptions.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Sin categorías para este tipo</div>
                    ) : (
                      categoryNameOptions.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Subcategoría</Label>
                <Select
                  value={form.itemId ?? NO_ITEM}
                  onValueChange={(value) => patch({ itemId: value === NO_ITEM ? null : value })}
                  disabled={formItems.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={formItems.length === 0 ? "Sin subcategorías" : "Sin subcategoría"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ITEM}>Sin subcategoría</SelectItem>
                    {formItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Dirección del monto</Label>
                <Select value={form.amountDirection} onValueChange={(value) => patch({ amountDirection: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AMOUNT_DIRECTION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Método de pago</Label>
                <Select value={form.paymentMethod} onValueChange={(value) => patch({ paymentMethod: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Prioridad</Label>
                <Input
                  type="number"
                  value={form.priority}
                  onChange={(event) => patch({ priority: event.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">Ante empate, gana la regla de mayor prioridad.</p>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/5 bg-background/30 px-3 py-2">
                <div>
                  <Label className="text-sm">Activa</Label>
                  <p className="text-[11px] text-muted-foreground">Solo las reglas activas se aplican al importar.</p>
                </div>
                <Switch checked={form.isActive} onCheckedChange={(checked) => patch({ isActive: checked })} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Monto desde</Label>
                <Input
                  type="number"
                  value={form.amountMin}
                  onChange={(event) => patch({ amountMin: event.target.value })}
                  placeholder="opcional"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Monto hasta</Label>
                <Input
                  type="number"
                  value={form.amountMax}
                  onChange={(event) => patch({ amountMax: event.target.value })}
                  placeholder="opcional"
                />
              </div>
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                Opcional. Limita la regla a un rango de monto — útil para separar cargos con el mismo texto pero distinto valor (ej. ChatGPT vía Apple).
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Textarea
                value={form.notes}
                onChange={(event) => patch({ notes: event.target.value })}
                rows={2}
                placeholder="Opcional"
              />
            </div>
          </FinanceDialogBody>
          <FinanceDialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear regla"}
            </Button>
          </FinanceDialogFooter>
        </FinanceDialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => (open ? null : setPendingDelete(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar regla</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará "{pendingDelete?.name}". Las importaciones futuras dejarán de auto-categorizar con esta regla.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRule.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={deleteRule.isPending}
            >
              {deleteRule.isPending ? "Eliminando…" : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
