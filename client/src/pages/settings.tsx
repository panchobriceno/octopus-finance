import { useEffect, useState } from "react";
import { CreditCard, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { getCreditCards, saveCreditCards } from "@/lib/credit-cards";

const STORAGE_KEY = "octopus_app_logo";

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

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <ImagePlus className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Branding</h2>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Logo de la app</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {logoDataUrl ? (
              <img src={logoDataUrl} alt="Logo actual" className="size-20 rounded-xl object-cover border" />
            ) : (
              <div className="size-20 rounded-xl border border-dashed flex items-center justify-center text-xs text-muted-foreground">
                Sin logo
              </div>
            )}
            <div className="space-y-3">
              <label className="inline-flex">
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                <span className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer">
                  Subir logo
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                Se guarda en este navegador y se muestra en la barra lateral.
              </p>
            </div>
          </div>

          {logoDataUrl && (
            <Button type="button" variant="outline" className="gap-2" onClick={handleRemove}>
              <Trash2 className="size-4" />
              Quitar logo
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CreditCard className="size-4" />
            Tarjetas de crédito
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
              <p className="text-sm text-muted-foreground">Aún no hay tarjetas guardadas.</p>
            ) : (
              creditCards.map((card) => (
                <div key={card} className="flex items-center justify-between rounded-lg border px-3 py-2">
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
  );
}
