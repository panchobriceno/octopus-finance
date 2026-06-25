import { useMemo, useState } from "react";
import { useClients, useCreateClient, useUpdateClient } from "@/lib/hooks";
import type { Client } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Repeat, Save } from "lucide-react";

function formatCLP(value: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

type FormState = {
  id: string | null;
  name: string;
  rut: string;
  serviceItem: string;
  monthlyNetAmount: string;
  vatApplies: boolean;
  billingDay: string;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  rut: "",
  serviceItem: "",
  monthlyNetAmount: "",
  vatApplies: true,
  billingDay: "5",
  active: true,
};

// Lecturas tolerantes: los clientes viejos no tienen los campos de recurrencia.
const readNet = (c: Client) => (typeof c.monthlyNetAmount === "number" ? c.monthlyNetAmount : null);
const readActive = (c: Client) => c.active ?? true;
const readVat = (c: Client) => c.vatApplies ?? true;
const readDay = (c: Client) => (typeof c.billingDay === "number" ? c.billingDay : 5);

export function RecurringClientsSection() {
  const { data: clients = [] } = useClients();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const saving = createClient.isPending || updateClient.isPending;

  const ordered = useMemo(
    () =>
      [...clients].sort((a, b) => {
        // activos primero, luego por nombre
        const activeDiff = Number(readActive(b)) - Number(readActive(a));
        if (activeDiff !== 0) return activeDiff;
        return `${a.name ?? ""}`.localeCompare(`${b.name ?? ""}`);
      }),
    [clients],
  );

  const openNew = () => {
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (c: Client) => {
    const net = readNet(c);
    setForm({
      id: c.id,
      name: c.name ?? "",
      rut: c.rut ?? "",
      serviceItem: c.serviceItem ?? "",
      monthlyNetAmount: net != null ? String(net) : "",
      vatApplies: readVat(c),
      billingDay: String(readDay(c)),
      active: readActive(c),
    });
    setOpen(true);
  };

  const save = async () => {
    const name = form.name.trim();
    const net = Number.parseInt(form.monthlyNetAmount || "0", 10);
    const day = Number.parseInt(form.billingDay || "5", 10);

    if (!name) {
      toast({ title: "Falta el nombre del cliente", variant: "destructive" });
      return;
    }
    if (form.active && !(net > 0)) {
      toast({
        title: "El monto mensual debe ser mayor a 0",
        description: "Un cliente activo necesita un monto recurrente.",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(day) || day < 1 || day > 28) {
      toast({
        title: "Día de facturación inválido",
        description: "Elegí un día entre 1 y 28.",
        variant: "destructive",
      });
      return;
    }

    // Normalizamos: nada de undefined a Firestore; vacío -> null.
    const payload = {
      name,
      rut: form.rut.trim() || null,
      serviceItem: form.serviceItem.trim() || null,
      monthlyNetAmount: net > 0 ? net : null,
      vatApplies: Boolean(form.vatApplies),
      billingDay: day,
      active: Boolean(form.active),
    };

    try {
      if (form.id) {
        await updateClient.mutateAsync({ id: form.id, data: payload });
        toast({ title: "Cliente actualizado" });
      } else {
        await createClient.mutateAsync(payload);
        toast({ title: "Cliente recurrente creado" });
      }
      setOpen(false);
      setForm(EMPTY_FORM);
    } catch {
      toast({ title: "No se pudo guardar el cliente", variant: "destructive" });
    }
  };

  const toggleActive = async (c: Client) => {
    try {
      await updateClient.mutateAsync({ id: c.id, data: { active: !readActive(c) } });
    } catch {
      toast({ title: "No se pudo cambiar el estado", variant: "destructive" });
    }
  };

  const grossOf = (net: number | null, vat: boolean) =>
    net == null ? null : Math.round(net * (vat ? 1.19 : 1));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Repeat className="size-4 text-primary" />
            Clientes recurrentes
          </CardTitle>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Definí una vez el monto mensual de cada cliente. Cada mes se factura solo ese valor
            (los cobros adicionales se cargan aparte como ingresos sueltos).
          </p>
        </div>
        <Button onClick={openNew} className="h-8 gap-1.5 bg-[#cdfa46] text-[#0a0a0f] hover:bg-[#bdf03a]">
          <Plus className="size-4" />
          Nuevo cliente
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Cliente</TableHead>
              <TableHead>Servicio</TableHead>
              <TableHead className="text-right">Monto mensual (neto)</TableHead>
              <TableHead className="text-right">Con IVA</TableHead>
              <TableHead className="text-center">Día</TableHead>
              <TableHead className="text-center">Estado</TableHead>
              <TableHead className="text-right pr-5">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((c) => {
              const net = readNet(c);
              const active = readActive(c);
              const gross = grossOf(net, readVat(c));
              return (
                <TableRow key={c.id} className={active ? "" : "opacity-55"}>
                  <TableCell className="pl-5">
                    <div className="font-medium">{c.name}</div>
                    {c.rut ? <div className="text-xs text-muted-foreground">{c.rut}</div> : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.serviceItem ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {net != null ? (
                      formatCLP(net)
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin configurar</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {readVat(c) ? (gross != null ? `Total ${formatCLP(gross)}` : "Sí") : "No"}
                  </TableCell>
                  <TableCell className="text-center text-sm tabular-nums">{readDay(c)}</TableCell>
                  <TableCell className="text-center">
                    {active ? (
                      <Badge className="bg-[rgba(205,250,70,0.14)] text-[#cdfa46] hover:bg-[rgba(205,250,70,0.2)]">
                        Activo
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">
                        Inactivo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-5">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(c)}>
                        <Pencil className="size-3.5 text-muted-foreground" />
                      </Button>
                      <Switch
                        checked={active}
                        onCheckedChange={() => toggleActive(c)}
                        aria-label={active ? "Desactivar cliente" : "Activar cliente"}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {ordered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  Todavía no hay clientes. Creá el primero con su monto mensual.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar cliente" : "Nuevo cliente recurrente"}</DialogTitle>
            <DialogDescription>
              El monto se hereda todos los meses. Si un mes cambia, lo ajustás en ese mes puntual.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-1">
            <div className="grid gap-1.5">
              <Label>Nombre</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nombre del cliente"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>RUT (opcional)</Label>
                <Input
                  value={form.rut}
                  onChange={(e) => setForm((f) => ({ ...f, rut: e.target.value }))}
                  placeholder="11.111.111-1"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Servicio (opcional)</Label>
                <Input
                  value={form.serviceItem}
                  onChange={(e) => setForm((f) => ({ ...f, serviceItem: e.target.value }))}
                  placeholder="Ej: Gestión RRSS"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Monto mensual (neto)</Label>
                <Input
                  inputMode="numeric"
                  value={form.monthlyNetAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, monthlyNetAmount: e.target.value.replace(/[^\d]/g, "") }))
                  }
                  placeholder="500000"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Día de facturación (1–28)</Label>
                <Input
                  inputMode="numeric"
                  value={form.billingDay}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, billingDay: e.target.value.replace(/[^\d]/g, "").slice(0, 2) }))
                  }
                  placeholder="5"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-card-border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">Aplica IVA (19%)</div>
                <div className="text-xs text-muted-foreground">El total a facturar incluye el IVA</div>
              </div>
              <Switch
                checked={form.vatApplies}
                onCheckedChange={(v) => setForm((f) => ({ ...f, vatApplies: v }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-card-border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">Cliente activo</div>
                <div className="text-xs text-muted-foreground">Se factura todos los meses</div>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="gap-1.5 bg-[#cdfa46] text-[#0a0a0f] hover:bg-[#bdf03a]"
            >
              <Save className="size-4" />
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
