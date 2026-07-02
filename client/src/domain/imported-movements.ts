export type DeletedTransactionMovementReset = {
  status: "pending" | "discarded";
  notes: string;
  clearConvertedAt?: boolean;
};

export function buildDeletedTransactionMovementPatch(
  reset: DeletedTransactionMovementReset,
  updatedAt: string,
) {
  return {
    status: reset.status,
    matchedTransactionId: null,
    notes: reset.notes,
    updatedAt,
    ...(reset.clearConvertedAt ? { convertedAt: null } : {}),
  };
}

export function buildRevertResolvedMovementPatch(updatedAt: string) {
  return {
    status: "pending",
    matchedTransactionId: null,
    duplicateTransactionId: null,
    convertedAt: null,
    notes: "Resolución deshecha; movimiento devuelto a revisión",
    updatedAt,
  };
}
