import { describe, expect, it } from "vitest";
import { buildDeletedTransactionMovementPatch } from "../imported-movements";

describe("imported movement cleanup", () => {
  it("returns a movement to pending review when its converted transaction is deleted", () => {
    expect(
      buildDeletedTransactionMovementPatch(
        {
          status: "pending",
          notes: "Transacción eliminada; movimiento devuelto a revisión",
          clearConvertedAt: true,
        },
        "2026-07-02T10:00:00.000Z",
      ),
    ).toEqual({
      status: "pending",
      matchedTransactionId: null,
      convertedAt: null,
      notes: "Transacción eliminada; movimiento devuelto a revisión",
      updatedAt: "2026-07-02T10:00:00.000Z",
    });
  });

  it("keeps duplicate resolution discarded without changing convertedAt", () => {
    expect(
      buildDeletedTransactionMovementPatch(
        {
          status: "discarded",
          notes: "Duplicado resuelto desde el asesor",
        },
        "2026-07-02T10:00:00.000Z",
      ),
    ).toEqual({
      status: "discarded",
      matchedTransactionId: null,
      notes: "Duplicado resuelto desde el asesor",
      updatedAt: "2026-07-02T10:00:00.000Z",
    });
  });
});
