import { useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ImportDataPage from "@/pages/import-data";
import BankMovementsPage from "@/pages/bank-movements";
import { cn } from "@/lib/utils";

type WizardStep = "import" | "review";

const STEPS: { key: WizardStep | "confirm"; n: number; label: string }[] = [
  { key: "import", n: 1, label: "Subir cartola" },
  { key: "review", n: 2, label: "Revisar movimientos" },
  { key: "confirm", n: 3, label: "Confirmar importación" },
];

/**
 * Wizard de importación en pop-up. El paso 3 se ejecuta como preflight dentro
 * de BankMovementsPage para conservar la lógica existente de conversión masiva.
 *
 * REUTILIZA las páginas existentes en modo embebido (ImportDataPage,
 * BankMovementsPage); no reescribe el parser ni la conversión. El "Confirmar
 * importación" es el preflight de conversión masiva que ya vive en la página de
 * revisión. /import queda como ruta legacy que abre este wizard y aterriza en
 * /movements; /movements sigue funcionando standalone.
 */
export function ImportWizardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState<WizardStep>("import");
  const [batchId, setBatchId] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setStep("import");
      setBatchId(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">Importar cartola</DialogTitle>
        <DialogDescription className="sr-only">
          Asistente de importación de cartolas en tres pasos.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3 pr-12">
          {STEPS.map((s, index) => {
            const active = s.key === step;
            const done = step === "review" && s.key === "import";
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    active
                      ? "bg-[#cdfa46] text-[#0a0a0f]"
                      : done
                        ? "bg-[#cdfa46] text-[#0a0a0f]"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : s.n}
                </span>
                <span className={cn("text-sm", active ? "font-semibold" : "text-muted-foreground")}>
                  {s.label}
                </span>
                {index < STEPS.length - 1 ? (
                  <span className="mx-1 hidden h-px w-8 bg-border sm:block" aria-hidden />
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {step === "import" ? (
            <ImportDataPage
              embedded
              onImported={(id) => {
                setBatchId(id);
                setStep("review");
              }}
            />
          ) : batchId ? (
            <div className="space-y-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                onClick={() => {
                  setBatchId(null);
                  setStep("import");
                }}
              >
                <ArrowLeft className="size-4" />
                Volver a subir cartola
              </Button>
              <BankMovementsPage
                embedded
                batchIdOverride={batchId}
                onDone={() => handleOpenChange(false)}
              />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
