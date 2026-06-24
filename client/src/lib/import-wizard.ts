export const IMPORT_WIZARD_OPEN_EVENT = "octopus-import-wizard-open";

export function openImportWizard() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(IMPORT_WIZARD_OPEN_EVENT));
}
