import { useEffect, useState } from "react";
import type { CommitmentInstance } from "@shared/schema";
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
import { Badge } from "@/components/ui/badge";
import { formatCLP, formatDate } from "@/lib/utils";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type Props = {
  /** Instancia a pagar; null cierra el modal. */
  instance: CommitmentInstance | null;
  isPending?: boolean;
  onOpenChange: (open: boolean) => void;
  /** El padre dispara la mutación (la lógica vive en la página). */
  onConfirm: (data: { paidAt: string }) => void;
};

/**
 * Modal "Registrar pago" de un compromiso — modal 3 del handoff.
 *
 * Presentación sobre la mutación existente (updateCommitmentInstance). Solo
 * persiste lo que el schema consume sin conflictos: status="paid" y paidAt. El
 * "monto del compromiso" se muestra read-only (expectedAmount); no se edita un
 * "monto pagado" porque no hay campo que lo consuma. NO escribe accountId: ese
 * campo es la "cuenta esperada" que usa la conciliación, no la cuenta de pago
 * (un "Pagado desde" real necesitaría un campo de schema nuevo). "Vincular
 * cartola" queda fuera (es conciliación, depende de matchedTransactionId).
 */
export function CommitmentPaymentDialog({
  instance,
  isPending,
  onOpenChange,
  onConfirm,
}: Props) {
  const [paidAt, setPaidAt] = useState("");

  useEffect(() => {
    if (instance) {
      setPaidAt(instance.paidAt ?? todayISO());
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
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-commitment-payment">
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm({ paidAt })}
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
