import { useEffect, useState } from "react";
import type { Account, CommitmentInstance } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatCLP, formatDate } from "@/lib/utils";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type Props = {
  /** Instancia a pagar; null cierra el modal. */
  instance: CommitmentInstance | null;
  /** Cuentas seleccionables para "Pagado desde". */
  accounts: Account[];
  isPending?: boolean;
  onOpenChange: (open: boolean) => void;
  /** El padre dispara la mutación (la lógica vive en la página). */
  onConfirm: (data: { paidAt: string; accountId: string | null }) => void;
};

/**
 * Modal "Registrar pago" de un compromiso — modal 3 del handoff.
 *
 * Presentación sobre la mutación existente (updateCommitmentInstance). Solo
 * persiste campos reales del schema: status="paid", paidAt y accountId. El
 * "monto del compromiso" se muestra read-only (expectedAmount); no se edita un
 * "monto pagado" porque no hay campo que lo consuma. "Vincular cartola" queda
 * fuera (es conciliación, depende de matchedTransactionId del flujo de import).
 */
export function CommitmentPaymentDialog({
  instance,
  accounts,
  isPending,
  onOpenChange,
  onConfirm,
}: Props) {
  const [paidAt, setPaidAt] = useState("");
  const [accountId, setAccountId] = useState("none");

  useEffect(() => {
    if (instance) {
      setPaidAt(instance.paidAt ?? todayISO());
      setAccountId(instance.accountId ?? "none");
    }
  }, [instance]);

  const overdue =
    !!instance && instance.status !== "paid" && instance.dueDate < todayISO();

  return (
    <Dialog open={!!instance} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
          <DialogDescription>{instance?.name ?? ""}</DialogDescription>
        </DialogHeader>

        {instance ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-card/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Monto del compromiso</span>
                {overdue ? (
                  <Badge className="border-[#ff6f8d]/25 bg-[#ff6f8d]/15 text-[#ff8da3]">
                    Vence {formatDate(instance.dueDate)}
                  </Badge>
                ) : (
                  <Badge variant="outline">Vence {formatDate(instance.dueDate)}</Badge>
                )}
              </div>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {formatCLP(instance.expectedAmount)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="commitment-paid-at">Fecha de pago</Label>
                <Input
                  id="commitment-paid-at"
                  type="date"
                  value={paidAt}
                  onChange={(event) => setPaidAt(event.target.value)}
                  data-testid="input-commitment-paid-at"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pagado desde</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger data-testid="select-commitment-paid-account">
                    <SelectValue placeholder="Sin cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin cuenta fija</SelectItem>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                        {account.bank ? ` · ${account.bank}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-commitment-payment">
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm({ paidAt, accountId: accountId === "none" ? null : accountId })}
            disabled={isPending || !paidAt}
            data-testid="button-confirm-commitment-payment"
          >
            {isPending ? "Guardando..." : "Marcar como pagado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
