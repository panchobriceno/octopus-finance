import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { NAV_GROUPS } from "@/lib/navigation";

/**
 * Command palette global (Cmd/Ctrl+K) — Fase 2.3.
 *
 * Salta a cualquier pantalla. Requiere el modificador meta/ctrl, así que no se
 * dispara escribiendo texto normal en inputs (guard que pidió codex). El
 * MonthSwitcher global queda diferido: cada página tiene su propio estado de mes
 * y unificarlo es un refactor de estado de negocio, no presentación.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      // Ctrl+K es un atajo nativo de edición de texto en macOS ("borrar hasta fin
      // de línea"). No lo secuestramos cuando el foco está en un campo editable.
      // Cmd+K no tiene ese conflicto y sigue funcionando en todos lados.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true;
      if (editable && event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setOpen((prev) => !prev);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar pantalla… (Cmd+K)" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>
        {NAV_GROUPS.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map((item) => (
              <CommandItem
                key={item.url}
                value={item.title}
                onSelect={() => {
                  setOpen(false);
                  navigate(item.url);
                }}
              >
                <item.icon className="mr-2 size-4" />
                {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
