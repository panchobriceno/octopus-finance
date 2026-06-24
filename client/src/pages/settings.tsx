import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BadgeCheck,
  CreditCard,
  ImagePlus,
  Plus,
  Rocket,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { getCreditCards, saveCreditCards } from "@/lib/credit-cards";
import { openImportWizard } from "@/lib/import-wizard";

const STORAGE_KEY = "octopus_app_logo";

function StateBadge({ children, tone }: { children: string; tone: "good" | "warn" | "muted" }) {
  const toneClasses = {
    good: "border-lime-500/20 bg-lime-500/10 text-lime-200",
    warn: "border-zinc-500/20 bg-zinc-500/10 text-zinc-200",
    muted: "border-[#cdfa46]/10 bg-[#cdfa46]/10 text-[#f4f4f7]",
  }[tone];

  return (
    <Badge variant="outline" className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${toneClasses}`}>
      {children}
    </Badge>
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  href?: string;
  icon: typeof ArrowRight;
  title: string;
  description: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <Icon className="size-4 shrink-0 text-primary" />
      <span className="flex flex-col items-start gap-1">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </>
  );

  if (onClick) {
    return (
      <Button
        variant="outline"
        onClick={onClick}
        className="h-auto justify-start rounded-2xl border-[#cdfa46]/10 bg-background/40 px-4 py-4 text-left"
      >
        {content}
      </Button>
    );
  }

  return (
    <Button asChild variant="outline" className="h-auto justify-start rounded-2xl border-[#cdfa46]/10 bg-background/40 px-4 py-4 text-left">
      <Link href={href ?? "/"}>{content}</Link>
    </Button>
  );
}

export default function SettingsPage() {
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [creditCards, setCreditCards] = useState<string[]>([]);
  const [newCreditCardName, setNewCreditCardName] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setLogoDataUrl(window.localStorage.getItem(STORAGE_KEY));
    setCreditCards(getCreditCards());
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result || typeof window === "undefined") return;
      window.localStorage.setItem(STORAGE_KEY, result);
      window.dispatchEvent(new Event("octopus-logo-updated"));
      setLogoDataUrl(result);
      toast({ title: "Logo actualizado" });
    };
    reader.readAsDataURL(file);
  };

  const handleRemove = () => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("octopus-logo-updated"));
    setLogoDataUrl(null);
    toast({ title: "Logo eliminado" });
  };

  const handleAddCreditCard = () => {
    const name = newCreditCardName.trim();
    if (!name) return;
    const next = Array.from(new Set([...creditCards, name]));
    setCreditCards(next);
    saveCreditCards(next);
    setNewCreditCardName("");
    toast({ title: "Tarjeta agregada" });
  };

  const handleRemoveCreditCard = (name: string) => {
    const next = creditCards.filter((card) => card !== name);
    setCreditCards(next);
    saveCreditCards(next);
    toast({ title: "Tarjeta eliminada" });
  };

  const logoSrc = logoDataUrl ?? "/octopus-logo.svg";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="rounded-3xl border border-[#cdfa46]/10 bg-gradient-to-br from-[#151223] via-[#0d0d12] to-[#0a0a0f] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Sparkles className="size-5 text-primary" />
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-primary/80">Configuración</p>
              </div>
              <h2 className="text-3xl font-black tracking-tight text-foreground">Centro de control</h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Ajusta el branding, revisa estados operativos y entra rápido a las partes más usadas de la app sin depender
                de flujos externos como camino principal.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="rounded-full border-[#cdfa46]/15 bg-background/40">
                <Link href="/">
                  <BadgeCheck className="mr-2 size-4" />
                  Ir al resumen
                </Link>
              </Button>
              <Button asChild className="rounded-full">
                <Link href="/monthly-close">
                  <ArrowRight className="mr-2 size-4" />
                  Continuar al cierre
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="border-[#cdfa46]/10 bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <ImagePlus className="size-4 text-primary" />
                Branding activo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <img
                  src={logoSrc}
                  alt="Logo de Octopus"
                  className="size-20 rounded-2xl border border-[#cdfa46]/15 object-cover shadow-lg"
                />
                <div className="space-y-2">
                  <StateBadge tone={logoDataUrl ? "good" : "warn"}>{logoDataUrl ? "Logo personalizado" : "Logo base"}</StateBadge>
                  <p className="text-sm text-muted-foreground">
                    Este logo se ve en la navegación desktop y móvil. Si subes uno nuevo, se aplica de inmediato.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="inline-flex">
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                  <span className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
                    <Plus className="size-4" />
                    Subir logo
                  </span>
                </label>
                {logoDataUrl && (
                  <Button type="button" variant="outline" className="rounded-xl" onClick={handleRemove}>
                    <Trash2 className="mr-2 size-4" />
                    Quitar
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#cdfa46]/10 bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Workflow className="size-4 text-primary" />
                Estado operativo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#cdfa46]/10 bg-background/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Branding</p>
                    <p className="text-xs text-muted-foreground">Logo visible en toda la app</p>
                  </div>
                  <StateBadge tone={logoDataUrl ? "good" : "warn"}>{logoDataUrl ? "Listo" : "Pendiente"}</StateBadge>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#cdfa46]/10 bg-background/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Flujo principal</p>
                    <p className="text-xs text-muted-foreground">Edición directa dentro de la app</p>
                  </div>
                  <StateBadge tone="good">Activo</StateBadge>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#cdfa46]/10 bg-background/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Automatizaciones externas</p>
                    <p className="text-xs text-muted-foreground">No son el camino principal para operar</p>
                  </div>
                  <StateBadge tone="muted">Soporte</StateBadge>
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                La idea es que la configuración muestre estado real y no confunda: lo importante vive acá, y lo externo solo
                acompaña si hace falta.
              </p>
            </CardContent>
          </Card>

          <Card className="border-[#cdfa46]/10 bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Rocket className="size-4 text-primary" />
                Atajos útiles
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <QuickLink href="/" icon={ArrowRight} title="Ver resumen" description="Volver al panel principal." />
              <QuickLink href="/cash-flow" icon={ArrowRight} title="Abrir flujo de caja" description="Ir al tablero financiero." />
              <QuickLink icon={ArrowRight} title="Importar datos" description="Cargar o revisar movimientos." onClick={openImportWizard} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="border-[#cdfa46]/10 bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <ImagePlus className="size-4 text-primary" />
                Logo de la app
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex size-20 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[#cdfa46]/20 bg-background/40">
                  <img src={logoSrc} alt="Previsualización del logo" className="size-full object-cover" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    {logoDataUrl ? "Logo personalizado cargado" : "Logo base de Octopus"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Se guarda solo en este navegador y se sincroniza al instante con la barra lateral.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <label className="inline-flex">
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                  <span className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
                    Subir otro logo
                  </span>
                </label>
                {logoDataUrl && (
                  <Button type="button" variant="ghost" className="gap-2 px-0 text-muted-foreground" onClick={handleRemove}>
                    <Trash2 className="size-4" />
                    Volver al logo base
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-[#cdfa46]/10 bg-card/90">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <CreditCard className="size-4 text-primary" />
                Tarjetas guardadas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-[#cdfa46]/10 bg-background/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-2xl font-black tracking-tight">{creditCards.length}</p>
                    <p className="text-sm text-muted-foreground">Tarjetas registradas en esta sesión</p>
                  </div>
                  <StateBadge tone={creditCards.length > 0 ? "good" : "warn"}>
                    {creditCards.length > 0 ? "Listo" : "Vacío"}
                  </StateBadge>
                </div>
              </div>

              <div className="flex flex-col gap-3 md:flex-row">
                <Input
                  value={newCreditCardName}
                  onChange={(e) => setNewCreditCardName(e.target.value)}
                  placeholder="Ej: Itaú Javi"
                />
                <Button type="button" onClick={handleAddCreditCard} disabled={!newCreditCardName.trim()}>
                  <Plus className="size-4" />
                  Agregar
                </Button>
              </div>

              <div className="space-y-2">
                {creditCards.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#cdfa46]/15 p-4">
                    <p className="text-sm text-muted-foreground">Aún no hay tarjetas guardadas.</p>
                  </div>
                ) : (
                  creditCards.map((card) => (
                    <div key={card} className="flex items-center justify-between rounded-2xl border border-[#cdfa46]/10 bg-background/30 px-4 py-3">
                      <span className="text-sm font-medium">{card}</span>
                      <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveCreditCard(card)}>
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
