import { afterEach, describe, expect, it, vi } from "vitest";
import { getTodayLocalDateKey } from "../finance";

describe("finance date helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("uses the local calendar day for business dates near midnight", () => {
    vi.stubEnv("TZ", "America/Santiago");
    vi.useFakeTimers();
    const lateNightChile = new Date("2026-07-01T01:30:00.000Z");
    vi.setSystemTime(lateNightChile);

    const chileDateKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(lateNightChile);

    expect(lateNightChile.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(chileDateKey).toBe("2026-06-30");
    expect(getTodayLocalDateKey()).toBe(chileDateKey);
  });
});
