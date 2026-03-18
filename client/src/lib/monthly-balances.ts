import { useEffect, useState } from "react";

const STORAGE_KEY = "octopus_monthly_balance";

export type MonthlyBalanceMap = Record<string, number>;

function isBrowser() {
  return typeof window !== "undefined";
}

function parseBalances(raw: string | null): MonthlyBalanceMap {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value)),
    );
  } catch {
    return {};
  }
}

export function getMonthlyBalances(): MonthlyBalanceMap {
  if (!isBrowser()) return {};
  return parseBalances(window.localStorage.getItem(STORAGE_KEY));
}

export function getOpeningBalance(monthKey: string): number {
  return getMonthlyBalances()[monthKey] ?? 0;
}

export function setOpeningBalance(monthKey: string, amount: number) {
  if (!isBrowser()) return;

  const balances = getMonthlyBalances();
  balances[monthKey] = Number.isFinite(amount) ? amount : 0;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(balances));
  window.dispatchEvent(new CustomEvent("octopus-monthly-balance-updated"));
}

export function useOpeningBalance(monthKey: string) {
  const [amount, setAmount] = useState(() => getOpeningBalance(monthKey));

  useEffect(() => {
    setAmount(getOpeningBalance(monthKey));
  }, [monthKey]);

  useEffect(() => {
    if (!isBrowser()) return undefined;

    const sync = () => setAmount(getOpeningBalance(monthKey));

    window.addEventListener("storage", sync);
    window.addEventListener("octopus-monthly-balance-updated", sync);

    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("octopus-monthly-balance-updated", sync);
    };
  }, [monthKey]);

  const update = (value: number) => {
    const nextValue = Number.isFinite(value) ? value : 0;
    setOpeningBalance(monthKey, nextValue);
    setAmount(nextValue);
  };

  return { amount, update };
}
