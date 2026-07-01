import { useMemo, useState } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import type { Category, Item, MovementRule } from "@shared/schema";
import { useCreateMovementRule, useUpdateMovementRule } from "@/lib/hooks";
import { extractRuleKeywords, findRuleByKeyword, normalizeRuleText } from "@/domain/rule-keywords";
import { sanitizeRuleItemId } from "@/domain/movement-rules";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import {
  FinanceDialogBody,
  FinanceDialogContent,
  FinanceDialogFooter,
  FinanceDialogHeader,
} from "@/components/finance/finance-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const WORKSPACE_LABEL: Record<string, string> = {
  business: "Empresa",
  family: "Familia",
  dentist: "Consulta Dentista",
};

export interface LearnRuleTarget {
  id: string;
  name: string;
  category: string;
  itemId: string | null;
  workspace: string;
  type: "income" | "expense" | "credit_card_payment";
  accountType: "bank" | "credit";
}

export function LearnRuleDialog({
  open,
  onOpenChange,
  target,
  rules,
  categories,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: LearnRuleTarget | null;
  rules: MovementRule[];
  categories: Category[];
  items: Item[];
}) {
  const { toast } = useToast();
  const createRule = useCreateMovementRule();
  const updateRule = useUpdateMovementRule();

  const keywordOptions = useMemo(() => (target ? extractRuleKeywords(target.name) : []), [target]);
  const [keyword, setKeyword] = useState<string>("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  // Reset del estado local cuando cambia la fila objetivo. Se llavea por id (NO por nombre): dos
  // filas distintas pueden tener la misma descripción y el consentimiento de reemplazo no debe pegarse.
  const [lastTargetId, setLastTargetId] = useState<string | null>(null);
  if (target && target.id !== lastTargetId) {
    setLastTargetId(target.id);
    setKeyword(keywordOptions[0] ?? "");
    setConfirmReplace(false);
  }

  if (!target) return null;

  const movementType: "income" | "expense" = target.type === "income" ? "income" : "expense";
  const amountDirection = movementType;
  const paymentMethod = target.accountType === "credit" ? "credit_card" : "bank_account";
  const workspace = target.workspace;
  const category = target.category;
  // La subcategoría solo se persiste si es consistente con la categoría (misma regla que el editor).
  const itemId = sanitizeRuleItemId(categories, items, category, movementType, workspace, target.itemId);
  const itemName = itemId ? items.find((i) => i.id === itemId)?.name ?? null : null;

  const duplicate = keyword ? findRuleByKeyword(rules, keyword, amountDirection) : null;
  const sameTarget =
    duplicate != null &&
    duplicate.category.trim().toLowerCase() === category.trim().toLowerCase() &&
    (duplicate.workspace ?? "") === workspace;
  const mode: "create" | "update" | "conflict" =
    duplicate == null ? "create" : sameTarget ? "update" : "conflict";
  // Si la regla existente cubre otras keywords, el cambio también las afecta → consentimiento informado.
  const otherKeywords = duplicate
    ? (duplicate.keywords ?? []).filter((k) => normalizeRuleText(k) !== normalizeRuleText(keyword))
    : [];

  const saving = createRule.isPending || updateRule.isPending;
  const canSubmit = Boolean(keyword) && !saving && (mode !== "conflict" || confirmReplace);

  async function handleSubmit() {
    if (!keyword) return;
    try {
      if (mode === "create") {
        await createRule.mutateAsync({
          name: `Aprendida: ${keyword}`,
          keywords: [keyword],
          category, itemId, workspace, movementType, paymentMethod, amountDirection,
          priority: 5, isActive: true, notes: "Aprendida desde wizard",
        });
        toast({ title: "Regla creada", description: `"${keyword}" → ${category}${itemName ? ` › ${itemName}` : ""}` });
      } else if (duplicate) {
        // update (misma categoría/ámbito → agrega subcategoría) o conflict (reemplaza categoría/ámbito).
        await updateRule.mutateAsync({
          id: duplicate.id,
          data: mode === "conflict" ? { category, itemId, workspace } : { itemId },
        });
        toast({ title: "Regla actualizada", description: `"${keyword}" → ${category}${itemName ? ` › ${itemName}` : ""}` });
      }
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "No se pudo guardar la regla",
        description: error instanceof Error ? error.message : "Error desconocido",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onOpenChange(false))}>
      <FinanceDialogContent size="sm">
        <FinanceDialogHeader
          title="Aprender regla"
          icon={<Sparkles className="size-4" />}
          description="Convertí esta corrección en una regla para que las próximas cartolas se categoricen solas."
        />
        <FinanceDialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label>Palabra clave</Label>
            {keywordOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No se encontró una palabra clave utilizable en la descripción.</p>
            ) : (
              <Select value={keyword} onValueChange={(value) => { setKeyword(value); setConfirmReplace(false); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {keywordOptions.map((kw) => (
                    <SelectItem key={kw} value={kw}>{kw}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-muted-foreground">De: "{target.name}"</p>
          </div>

          <div className="rounded-xl border border-white/5 bg-background/30 p-3 text-sm">
            <p className="text-xs text-muted-foreground">La regla asignará:</p>
            <p className="mt-1 font-medium text-foreground">
              {category}{itemName ? ` › ${itemName}` : ""}
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              {WORKSPACE_LABEL[workspace] ?? workspace} · {movementType === "income" ? "ingreso" : "egreso"}
            </p>
          </div>

          {mode === "update" ? (
            <p className="text-xs text-muted-foreground">
              Ya existe la regla "{duplicate?.name}" para esta palabra. Se le {itemName ? `asignará la subcategoría "${itemName}"` : "quitará la subcategoría"}.
            </p>
          ) : null}
          {duplicate && otherKeywords.length > 0 ? (
            <p className="text-[11px] text-amber-400/90">
              Ojo: esta regla también se aplica a: {otherKeywords.join(", ")}. El cambio los afecta.
            </p>
          ) : null}
          {mode === "conflict" ? (
            <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
                <TriangleAlert className="size-3.5" />
                Conflicto con una regla existente
              </p>
              <p className="text-xs text-muted-foreground">
                La regla "{duplicate?.name}" ya asigna <span className="text-foreground">{duplicate?.category} · {WORKSPACE_LABEL[duplicate?.workspace ?? ""] ?? duplicate?.workspace}</span> a "{keyword}".
                Aprender esto la reemplazaría por <span className="text-foreground">{category} · {WORKSPACE_LABEL[workspace] ?? workspace}</span>.
              </p>
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
                Sí, reemplazar la regla existente
              </label>
            </div>
          ) : null}
        </FinanceDialogBody>
        <FinanceDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {saving ? "Guardando…" : mode === "create" ? "Crear regla" : mode === "conflict" ? "Reemplazar regla" : "Actualizar regla"}
          </Button>
        </FinanceDialogFooter>
      </FinanceDialogContent>
    </Dialog>
  );
}
