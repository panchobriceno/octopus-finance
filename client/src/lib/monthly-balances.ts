import { useEffect, useMemo, useRef, useState } from "react";
import type { OpeningBalance } from "@shared/schema";
import { setOpeningBalance as persistOpeningBalance } from "./firestore";
import { useOpeningBalances, useSetOpeningBalance } from "./hooks";
import { queryClient } from "./queryClient";

const STORAGE_KEY = "octopus_monthly_balance";
const MIGRATION_KEY = "octopus_monthly_balance_firestore_migrated_v1";

export type MonthlyBalanceMap = Record<string, number>;

let openingBalanceCache: MonthlyBalanceMap = {};

function isBrowser() {
  return typeof window !== "undefined";
}

function parseBalances(raw: string | null): MonthlyBalanceMap {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const validEntries = Object.entries(parsed).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
    );
    return Object.fromEntries(validEntries);
  } catch {
    return {};
  }
}

function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function formatMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function toBalanceMap(openingBalances: OpeningBalance[]): MonthlyBalanceMap {
  return openingBalances.reduce<MonthlyBalanceMap>((acc, openingBalance) => {
    acc[formatMonthKey(openingBalance.year, openingBalance.month)] = Number(openingBalance.amount) || 0;
    return acc;
  }, {});
}

function readLegacyBalances() {
  if (!isBrowser()) return {};
  return parseBalances(window.localStorage.getItem(STORAGE_KEY));
}

function markLegacyBalancesMigrated() {
  if (!isBrowser()) return;
  window.localStorage.setItem(MIGRATION_KEY, "1");
  window.localStorage.removeItem(STORAGE_KEY);
}

function legacyBalancesAlreadyMigrated() {
  if (!isBrowser()) return true;
  return window.localStorage.getItem(MIGRATION_KEY) === "1";
}

function broadcastOpeningBalanceUpdate() {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent("octopus-monthly-balance-updated"));
}

export function getMonthlyBalances(): MonthlyBalanceMap {
  return openingBalanceCache;
}

export function getOpeningBalance(monthKey: string): number {
  return openingBalanceCache[monthKey] ?? 0;
}

export async function setOpeningBalance(monthKey: string, amount: number) {
  const parsedMonth = parseMonthKey(monthKey);
  if (!parsedMonth) return;

  const normalizedAmount = Number.isFinite(amount) ? amount : 0;
  openingBalanceCache = {
    ...openingBalanceCache,
    [monthKey]: normalizedAmount,
  };
  broadcastOpeningBalanceUpdate();
  await persistOpeningBalance(monthKey, normalizedAmount);
  await queryClient.invalidateQueries({ queryKey: ["opening-balances"] });
}

export function useMonthlyBalances() {
  const { data: openingBalances = [], isLoading } = useOpeningBalances();
  const setOpeningBalanceMutation = useSetOpeningBalance();
  const migrationStartedRef = useRef(false);
  const balanceMap = useMemo(() => toBalanceMap(openingBalances), [openingBalances]);

  useEffect(() => {
    openingBalanceCache = balanceMap;
    broadcastOpeningBalanceUpdate();
  }, [balanceMap]);

  useEffect(() => {
    if (!isBrowser() || isLoading || legacyBalancesAlreadyMigrated() || migrationStartedRef.current) return;

    const legacyBalances = readLegacyBalances();
    if (!Object.keys(legacyBalances).length) {
      markLegacyBalancesMigrated();
      return;
    }

    const missingEntries = Object.entries(legacyBalances).filter(([monthKey]) => {
      if (!parseMonthKey(monthKey)) return false;
      return balanceMap[monthKey] === undefined;
    });

    if (!missingEntries.length) {
      markLegacyBalancesMigrated();
      return;
    }

    migrationStartedRef.current = true;

    Promise.all(
      missingEntries.map(([monthKey, amount]) =>
        setOpeningBalanceMutation.mutateAsync({ monthKey, amount }),
      ),
    )
      .then(() => {
        markLegacyBalancesMigrated();
      })
      .finally(() => {
        migrationStartedRef.current = false;
      });
  }, [balanceMap, isLoading, setOpeningBalanceMutation]);

  const update = async (monthKey: string, amount: number) => {
    const parsedMonth = parseMonthKey(monthKey);
    if (!parsedMonth) return;

    const normalizedAmount = Number.isFinite(amount) ? amount : 0;
    openingBalanceCache = {
      ...openingBalanceCache,
      [monthKey]: normalizedAmount,
    };
    broadcastOpeningBalanceUpdate();
    await setOpeningBalanceMutation.mutateAsync({ monthKey, amount: normalizedAmount });
  };

  return {
    balances: balanceMap,
    isLoading,
    isSaving: setOpeningBalanceMutation.isPending,
    update,
  };
}

export function useOpeningBalance(monthKey: string) {
  const { balances, update } = useMonthlyBalances();
  const [amount, setAmount] = useState(() => balances[monthKey] ?? 0);

  useEffect(() => {
    setAmount(balances[monthKey] ?? 0);
  }, [balances, monthKey]);

  const updateBalance = (value: number) => {
    const nextValue = Number.isFinite(value) ? value : 0;
    setAmount(nextValue);
    void update(monthKey, nextValue);
  };

  return { amount, update: updateBalance };
}
