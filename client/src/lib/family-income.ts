const STORAGE_KEY = "octopus_family_income_javi";

export function getFamilyIncomeJaviMap() {
  if (typeof window === "undefined") return {} as Record<string, number>;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] =>
        typeof entry[0] === "string" &&
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function setFamilyIncomeJavi(monthKey: string, amount: number) {
  if (typeof window === "undefined") return {};

  const current = getFamilyIncomeJaviMap();
  const next = { ...current, [monthKey]: amount };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("octopus-family-income-updated"));
  return next;
}
