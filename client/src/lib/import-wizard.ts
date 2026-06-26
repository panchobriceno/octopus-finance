export const IMPORT_WIZARD_OPEN_EVENT = "octopus-import-wizard-open";
export const IMPORT_WIZARD_CLOSE_EVENT = "octopus-import-wizard-close";

export function openImportWizard() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(IMPORT_WIZARD_OPEN_EVENT));
}

export function closeImportWizard() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(IMPORT_WIZARD_CLOSE_EVENT));
}
