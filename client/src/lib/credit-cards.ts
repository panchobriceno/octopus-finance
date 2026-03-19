const STORAGE_KEY = "octopus_credit_cards";

export function getCreditCards() {
  if (typeof window === "undefined") return [] as string[];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function saveCreditCards(cards: string[]) {
  if (typeof window === "undefined") return;

  const cleaned = Array.from(new Set(cards.map((card) => card.trim()).filter(Boolean)));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  window.dispatchEvent(new Event("octopus-credit-cards-updated"));
}
