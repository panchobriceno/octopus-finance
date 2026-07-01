import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAccounts, useCategories, useItems, useBulkDeleteTransactions, useCreateCategory, useCreateImportedMovementBatch, useCreditCardSettings, useImportBatches, useMovementRules, useTransactions, useUpdateTransaction } from "@/lib/hooks";
import type { Account, Category, ImportBatch, ImportedMovement, MovementRule, Transaction } from "@shared/schema";
import { applyMovementRule, findBestMovementRule } from "@/domain/bank-imports";
import { getCreditCards } from "@/lib/credit-cards";
// pdfjs (~1.4MB) se carga on-demand solo cuando hay que descifrar un PDF con
// contraseña (import dinámico abajo), para no pesar en el bundle de toda la app.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Upload, FileText, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type {
  AccountType,
  BankParser,
  ClaudePdfExtraction,
  ColumnMapping,
  CcMovementType,
  ImportWorkspace,
  ParsedPreviewRow,
} from "@/lib/parsers/types";
import {
  IMPORT_CONFIDENCE_DUPLICATE,
  IMPORT_CONFIDENCE_PENDING,
} from "@/lib/parsers/types";
import {
  PDF_COLUMN_HEADERS,
  detectHeaderRowIndex,
  extractDueDate,
  inferMapping,
  normalizeText,
  parseAmountValue,
  parseDateValue,
  parseInstallmentsValue,
  splitCsvLine,
} from "@/lib/parsers/csv-core";
import {
  categoryMatchesType,
  getDefaultExpenseCategoryOptions,
  suggestRowCategory,
  suggestRowType,
  suggestWorkspace,
} from "@/lib/parsers/suggestions";
import {
  detectMovementType,
  getCreditPreviewType,
  isSimilarCreditCardPayment,
} from "@/lib/parsers/credit-cards";
import { resolveParser } from "@/lib/parsers";

const IMPORT_WORKSPACES: ImportWorkspace[] = ["business", "family", "dentist"];
function clampWorkspace(value: string, fallback: ImportWorkspace): ImportWorkspace {
  return (IMPORT_WORKSPACES as string[]).includes(value) ? (value as ImportWorkspace) : fallback;
}

/**
 * Clasifica una fila del preview con las reglas de categorización (F2 paso 3), reusando la MISMA
 * lógica de dominio que el import batch (`applyMovementRule`) para no divergir. Respeta los locks
 * de corrección humana: un campo tocado (categoryTouched/itemTouched/workspaceTouched) no se pisa.
 * Sin regla que matchee y sin lock → heurística (suggestRowCategory / suggestWorkspace).
 */
function classifyPreviewRow(params: {
  name: string;
  type: "income" | "expense" | "credit_card_payment";
  amount: number;
  category?: string;
  itemId?: string | null;
  workspace?: ImportWorkspace;
  categoryTouched?: boolean;
  itemTouched?: boolean;
  workspaceTouched?: boolean;
  rules: MovementRule[];
  categories: Category[];
  accountType: "bank" | "credit";
  defaultImportWorkspace: ImportWorkspace;
}): { category: string; itemId: string | null; workspace: ImportWorkspace } {
  const direction: "income" | "expense" = params.type === "income" ? "income" : "expense";
  const heuristicCategory = suggestRowCategory(params.name, params.type, params.categories);
  const heuristicWorkspace = suggestWorkspace(params.name, heuristicCategory, params.type, params.accountType, params.defaultImportWorkspace);
  const movementLike = {
    description: params.name,
    rawDescription: params.name,
    sourceName: "",
    bankName: "",
    creditCardName: "",
    direction,
    amount: params.amount,
    suggestedCategory: params.categoryTouched ? (params.category || heuristicCategory) : heuristicCategory,
    suggestedItemId: (params.itemTouched || params.categoryTouched) ? (params.itemId ?? null) : null,
    suggestedWorkspace: params.workspaceTouched ? (params.workspace || heuristicWorkspace) : heuristicWorkspace,
    categoryTouched: params.categoryTouched,
    itemTouched: params.itemTouched,
    workspaceTouched: params.workspaceTouched,
  } as unknown as ImportedMovement;
  const rule = findBestMovementRule(movementLike, params.rules);
  const applied = rule ? applyMovementRule(movementLike, rule) : movementLike;
  return {
    category: applied.suggestedCategory,
    itemId: applied.suggestedItemId ?? null,
    workspace: clampWorkspace(applied.suggestedWorkspace, heuristicWorkspace),
  };
}

type ImportBatchSummary = {
  id: string;
  label: string;
  importedAt: string;
  cardName: string | null;
  rows: number;
  totalAmount: number;
  status?: string;
  kind: "review" | "legacy";
};

const IMPORT_BATCH_STATUS_LABELS: Record<string, string> = {
  reviewing: "En revisión",
  partially_converted: "Parcial",
  completed: "Listo",
  closed: "Cerrado",
};

function importBatchStatusTone(status: string) {
  if (status === "closed") return "bg-[rgba(205,250,70,0.14)] text-[#cdfa46]";
  if (status === "completed") return "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]";
  if (status === "partially_converted") return "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]";
  return "bg-[rgba(138,138,148,0.14)] text-[#8a8a94]";
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    let chunkBinary = "";
    for (let chunkIndex = 0; chunkIndex < chunk.length; chunkIndex += 1) {
      chunkBinary += String.fromCharCode(chunk[chunkIndex]);
    }
    binary += chunkBinary;
  }

  return btoa(binary);
}

export default function ImportDataPage({
  embedded = false,
  onImported,
}: {
  /** Embebido dentro del wizard de importación: oculta el chrome de página. */
  embedded?: boolean;
  /** Si se pasa, al crear el lote llama esto en vez de navegar a /movements. */
  onImported?: (batchId: string) => void;
} = {}) {
  const [, navigate] = useLocation();
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [previewRows, setPreviewRows] = useState<ParsedPreviewRow[]>([]);
  const [ignoredRowIds, setIgnoredRowIds] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState("");
  // Contraseña opcional para cartolas protegidas (ej. Banco Edwards). Si se ingresa,
  // el PDF se descifra en el navegador y al servidor solo va el texto.
  const [pdfPassword, setPdfPassword] = useState("");
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>("bank");
  const [mapping, setMapping] = useState<ColumnMapping>({ date: "", description: "", amount: "", installments: "" });
  const [savedCards, setSavedCards] = useState<string[]>([]);
  const [selectedCard, setSelectedCard] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [detectedParser, setDetectedParser] = useState<BankParser | null>(null);
  const [defaultImportWorkspace, setDefaultImportWorkspace] = useState<ImportWorkspace>("family");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryWorkspace, setNewCategoryWorkspace] = useState<"business" | "family" | "dentist">("family");
  const [batchToDelete, setBatchToDelete] = useState<ImportBatchSummary | null>(null);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);
  const [importDueDate, setImportDueDate] = useState<string | null>(null);
  const [isPdfProcessing, setIsPdfProcessing] = useState(false);
  const { toast } = useToast();

  const { data: categories = [] } = useCategories();
  const { data: items = [] } = useItems();
  const { data: movementRules = [] } = useMovementRules();
  const { data: transactions = [] } = useTransactions();
  const { data: accounts = [] } = useAccounts();
  const { data: creditCardSettings = [] } = useCreditCardSettings();
  const { data: reviewImportBatches = [] } = useImportBatches();
  const importMutation = useCreateImportedMovementBatch();
  const createCategoryMutation = useCreateCategory();
  const deleteImportMutation = useBulkDeleteTransactions();
  const updateTransactionMutation = useUpdateTransaction();

  const existingKeys = useMemo(() => new Set(
    transactions
      .filter((tx) => tx.status !== "cancelled")
      .map((tx) => `${tx.date}__${tx.name.trim().toLowerCase()}__${tx.type}__${tx.amount}`),
  ), [transactions]);

  const existingCreditCardPayments = useMemo(
    () =>
      transactions.filter((tx) => {
        const movementType = tx.movementType ?? (tx.type === "income" ? "income" : "expense");
        return movementType === "credit_card_payment" && tx.status !== "cancelled";
      }),
    [transactions],
  );

  const bankAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        const isBankType = account.type === "checking" || account.type === "savings";
        const isActive = (account as Account & { isActive?: boolean }).isActive ?? true;
        return isBankType && isActive;
      }),
    [accounts],
  );

  const selectedCreditCardSetting = useMemo(
    () =>
      creditCardSettings.find((setting) =>
        (setting.isActive ?? true) &&
        normalizeText(setting.cardName) === normalizeText(selectedCard),
      ) ?? null,
    [creditCardSettings, selectedCard],
  );

  const selectedCreditCardDefaultAccount = useMemo(
    () =>
      bankAccounts.find((account) => account.id === selectedCreditCardSetting?.defaultPaymentAccountId) ?? null,
    [bankAccounts, selectedCreditCardSetting],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncCards = () => {
      const cards = getCreditCards();
      setSavedCards(cards);
      setSelectedCard((current) => (current && cards.includes(current) ? current : ""));
    };
    syncCards();
    window.addEventListener("octopus-credit-cards-updated", syncCards);
    return () => window.removeEventListener("octopus-credit-cards-updated", syncCards);
  }, []);

  useEffect(() => {
    // Rebuild preview from scratch when switching between bank and credit logic.
    setPreviewRows([]);
  }, [accountType]);

  useEffect(() => {
    if (!csvRows.length || !mapping.date || !mapping.description || !mapping.amount) {
      setPreviewRows([]);
      return;
    }

    // Pre-compute raw rows for reversal detection (credit only)
    const allRawRows = accountType === "credit"
      ? csvRows.map((row) => ({
          name: (row[mapping.description] ?? "").trim(),
          rawAmount: parseAmountValue(row[mapping.amount] ?? ""),
          date: parseDateValue(row[mapping.date] ?? ""),
        }))
      : [];

    const nextRows = csvRows.map((row, index): ParsedPreviewRow | null => {
      const rowId = `${index}`;
      if (ignoredRowIds.has(rowId)) return null;

      const date = parseDateValue(row[mapping.date] ?? "");
      const name = (row[mapping.description] ?? "").trim();
      const rawAmount = parseAmountValue(row[mapping.amount] ?? "");
      const installments = parseInstallmentsValue(mapping.installments ? (row[mapping.installments] ?? "") : "");

      if (!date || !name || Number.isNaN(rawAmount)) {
        return {
          id: rowId,
          date: date || "-",
          name: name || "(sin descripción)",
          amount: 0,
          type: "expense",
          category: "Sin categoría",
          workspace: (accountType === "credit" ? defaultImportWorkspace : "business") as ImportWorkspace,
          installmentsLabel: installments.label,
          installmentCount: installments.count,
          duplicate: false,
          error: "Fila inválida. Revisa fecha, descripción o monto.",
        };
      }

      const ccMovementType: CcMovementType | undefined =
        accountType === "credit"
          ? detectMovementType(name, rawAmount, date, allRawRows)
          : undefined;

      const type: "income" | "expense" | "credit_card_payment" =
        accountType === "credit"
          ? getCreditPreviewType(ccMovementType)
          : suggestRowType(name, rawAmount >= 0 ? "income" : "expense");
      const amount = Math.abs(rawAmount);
      const storageType = accountType === "credit" ? "expense" : type;
      const key = `${date}__${name.toLowerCase()}__${storageType}__${amount}`;
      const duplicateTcPayment =
        accountType === "credit" &&
        ccMovementType === "tc_payment" &&
        Boolean(selectedCard.trim()) &&
        existingCreditCardPayments.some((tx) =>
          isSimilarCreditCardPayment(tx, selectedCard.trim(), amount, date),
        );

      const classified = classifyPreviewRow({
        name, type, amount, rules: movementRules, categories, accountType, defaultImportWorkspace,
      });
      return {
        id: rowId,
        date,
        name,
        amount,
        type,
        category: classified.category,
        itemId: classified.itemId,
        workspace: classified.workspace,
        installmentsLabel: installments.label,
        installmentCount: installments.count,
        duplicate: existingKeys.has(key) || duplicateTcPayment,
        ccMovementType,
      };
    }).filter((row): row is ParsedPreviewRow => row !== null);

    const seenInFile = new Set<string>();
    const dedupedRows = nextRows.map((row) => {
      if (row.error) return row;

      const storageType = accountType === "credit" ? "expense" : row.type;
      const key = `${row.date}__${row.name.trim().toLowerCase()}__${storageType}__${row.amount}`;
      const duplicateInFile = seenInFile.has(key);
      seenInFile.add(key);

      return {
        ...row,
        duplicate: row.duplicate || duplicateInFile,
      };
    });

    setPreviewRows((current) =>
      dedupedRows.map((row) => {
        const previous = current.find((item) => item.id === row.id);
        if (!previous) return row;

        const preservedCcMovementType =
          accountType === "credit"
            ? (previous.ccMovementType ?? row.ccMovementType)
            : row.ccMovementType;
        const preservedType =
          accountType === "credit"
            ? getCreditPreviewType(preservedCcMovementType)
            : row.type;
        const preservedStorageType = accountType === "credit" ? "expense" : preservedType;
        const duplicateTcPayment =
          accountType === "credit" &&
          preservedCcMovementType === "tc_payment" &&
          Boolean(selectedCard.trim()) &&
          existingCreditCardPayments.some((tx) =>
            isSimilarCreditCardPayment(tx, selectedCard.trim(), row.amount, row.date),
          );
        const duplicate = existingKeys.has(
          `${row.date}__${row.name.trim().toLowerCase()}__${preservedStorageType}__${row.amount}`,
        ) || duplicateTcPayment;
        // Si cambia el tipo (income↔expense), la categoría tocada ya no aplica → se sueltan los locks
        // para que reglas/heurística re-sugieran limpio (evita conservar una categoría inválida).
        const typeChanged = previous.type !== preservedType;
        const categoryTouched = typeChanged ? false : (previous.categoryTouched ?? false);
        const itemTouched = typeChanged ? false : (previous.itemTouched ?? false);
        const workspaceTouched = typeChanged ? false : (previous.workspaceTouched ?? false);

        const classified = classifyPreviewRow({
          name: row.name, type: preservedType, amount: row.amount,
          category: previous.category, itemId: previous.itemId ?? null, workspace: previous.workspace,
          categoryTouched, itemTouched, workspaceTouched,
          rules: movementRules, categories, accountType, defaultImportWorkspace,
        });

        return {
          ...row,
          category: classified.category,
          itemId: classified.itemId,
          workspace: classified.workspace,
          categoryTouched,
          itemTouched,
          workspaceTouched,
          installmentsLabel: previous.installmentsLabel || row.installmentsLabel,
          installmentCount: previous.installmentCount ?? row.installmentCount,
          type: preservedType,
          duplicate: row.duplicate || duplicate,
          ccMovementType: preservedCcMovementType,
        };
      }),
    );
  }, [csvRows, mapping, accountType, existingKeys, existingCreditCardPayments, ignoredRowIds, categories, movementRules, defaultImportWorkspace, selectedCard]);

  const handleImport = async () => {
    const queueableRows = previewRows.filter(
      (row) => !row.error && row.ccMovementType !== "reversal",
    );

    if (queueableRows.length === 0) {
      toast({
        title: "No hay movimientos para enviar",
        description: "Corrige las filas inválidas o elimina reversas antes de continuar.",
        variant: "destructive",
      });
      return;
    }

    if (accountType === "credit" && !selectedCard.trim()) {
      toast({
        title: "Falta seleccionar la tarjeta",
        description: "Elige a qué tarjeta corresponde esta cartola antes de importar.",
        variant: "destructive",
      });
      return;
    }

    const selectedAccount = selectedAccountId
      ? bankAccounts.find((account) => account.id === selectedAccountId) ?? null
      : null;
    const detectedBankName = accountType === "bank" ? detectedParser?.bankName ?? null : null;
    const importBankName = selectedAccount?.bank ?? detectedBankName;
    const batchLabel = accountType === "credit"
      ? `${fileName || detectedParser?.sourceName || "Cartola"} · ${selectedCard.trim()}`
      : `${fileName || detectedParser?.sourceName || "Importación CSV"} · ${importBankName ?? "Cuenta bancaria"}`;

    const mapped = queueableRows.map((row) => {
      const isTcPayment = accountType === "credit" && row.ccMovementType === "tc_payment";
      const effectiveMovementType =
        isTcPayment
          ? "credit_card_payment" as const
          : row.type === "income"
            ? "income" as const
            : row.type === "credit_card_payment"
              ? "credit_card_payment" as const
              : "expense" as const;

      return {
        date: row.date,
        description: row.name,
        amount: row.amount,
        direction: effectiveMovementType === "income" ? "income" as const : "expense" as const,
        category:
          row.category ||
          suggestRowCategory(
            row.name,
            accountType === "credit" ? getCreditPreviewType(row.ccMovementType) : row.type,
            categories,
          ),
        notes: importDueDate ? `Vence: ${importDueDate}` : null,
        workspace: row.workspace,
        // solo persistimos la subcategoría si pertenece a la categoría resuelta de la fila (consistencia item↔categoría)
        itemId: row.itemId && itemsForRow(row).some((item) => item.id === row.itemId) ? row.itemId : null,
        // Locks de corrección humana (F2 paso 3): la persistencia re-aplica reglas pero NO pisa lo tocado.
        categoryTouched: row.categoryTouched ?? false,
        itemTouched: row.itemTouched ?? false,
        workspaceTouched: row.workspaceTouched ?? false,
        movementType: effectiveMovementType,
        installmentCount: row.installmentCount,
        paymentMethod:
          accountType === "credit" && effectiveMovementType === "expense"
            ? "credit_card" as const
            : "bank_account" as const,
        source: "manual_file",
        sourceName: batchLabel,
        sourceType: accountType === "credit" ? "credit_card" as const : "bank_account" as const,
        bankName: accountType === "bank" ? importBankName ?? null : null,
        accountId:
          accountType === "bank"
            ? selectedAccountId || null
            : isTcPayment
              ? selectedCreditCardDefaultAccount?.id ?? null
              : null,
        creditCardName: accountType === "credit" ? selectedCard.trim() : null,
        confidence: row.duplicate ? IMPORT_CONFIDENCE_DUPLICATE : IMPORT_CONFIDENCE_PENDING,
        status: row.duplicate ? "duplicate" as const : "pending" as const,
      };
    });

    try {
      const result = await importMutation.mutateAsync({
        label: batchLabel,
        source: "manual_file",
        sourceName: batchLabel,
        sourceType: accountType === "credit" ? "credit_card" : "bank_account",
        bankName: accountType === "bank" ? importBankName ?? null : null,
        accountId: accountType === "bank" ? selectedAccountId || null : null,
        creditCardName: accountType === "credit" ? selectedCard.trim() : null,
        workspace: accountType === "credit" ? defaultImportWorkspace : selectedAccount?.workspace ?? "shared",
        notes: importDueDate ? `Fecha limite de pago: ${importDueDate}` : null,
        movements: mapped,
      });

      toast({
        title: "Movimientos enviados a revisión",
        description: `${result.pending} pendientes y ${result.duplicates} duplicados quedaron en la bandeja.`,
      });
      setCsvHeaders([]);
      setCsvRows([]);
      setPreviewRows([]);
      setIgnoredRowIds(new Set());
      setFileName("");
      setDetectedParser(null);
      setSelectedAccountId("");
      if (onImported) {
        onImported(result.batchId);
      } else {
        navigate(`/movements?batch=${encodeURIComponent(result.batchId)}`);
      }
    } catch {
      toast({
        title: "No se pudo crear la carga",
        description: "Hubo un problema al enviar los movimientos a revisión.",
        variant: "destructive",
      });
    }
  };

  const parseCSV = useCallback(
    (text: string, sourceFileName: string) => {
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/\r/g, ""))
        .filter(Boolean);

      if (lines.length < 2) {
        toast({
          title: "Archivo inválido",
          description: "El CSV debe tener al menos una cabecera y una fila de datos.",
          variant: "destructive",
        });
        return;
      }

      const delimiter = lines[0].includes(";") ? ";" : ",";
      const headerRowIndex = detectHeaderRowIndex(lines, delimiter);
      const rawHeaders = splitCsvLine(lines[headerRowIndex], delimiter);
      const headers = rawHeaders.map((header, index) => header || `columna_${index + 1}`);
      const rows = lines
        .slice(headerRowIndex + 1)
        .map((line) => {
        const values = splitCsvLine(line, delimiter);
        return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
        })
        .filter((row) =>
          Object.values(row).some((value) => value.trim() !== ""),
        );

      const parser = resolveParser({
        fileName: sourceFileName,
        headers,
        lines,
        accountType,
        sourceKind: "csv",
      });
      setDetectedParser(parser);
      const detectedCreditImport = parser.id === "credit-card";
      if (detectedCreditImport && accountType !== "credit") {
        setAccountType("credit");
      }

      if (accountType === "credit" || detectedCreditImport) {
        setImportDueDate(extractDueDate(lines, delimiter));
      } else {
        setImportDueDate(null);
      }
      setIgnoredRowIds(new Set());
      setCsvHeaders(headers);
      setCsvRows(rows);
      setMapping(parser.inferMapping?.(headers, rows) ?? inferMapping(headers, rows));
    },
    [toast, accountType],
  );

  const applyNormalizedImportRows = useCallback((
    headers: string[],
    rows: Record<string, string>[],
    options?: {
      detectedCreditImport?: boolean;
      dueDate?: string | null;
      forceMapping?: ColumnMapping;
      parser?: BankParser;
    },
  ) => {
    const detectedCreditImport = options?.detectedCreditImport ?? false;

    if (detectedCreditImport && accountType !== "credit") {
      setAccountType("credit");
    }

    if (detectedCreditImport) {
      setImportDueDate(options?.dueDate ?? null);
    } else {
      setImportDueDate(null);
    }

    setIgnoredRowIds(new Set());
    setCsvHeaders(headers);
    setCsvRows(rows);
    setMapping(options?.forceMapping ?? inferMapping(headers, rows));
    setDetectedParser(options?.parser ?? null);
  }, [accountType]);

  const parsePdfWithClaude = useCallback(async (file: File) => {
    // Si hay contraseña, desciframos en el navegador y mandamos solo el texto.
    let requestBody: { pdfBase64?: string; pdfText?: string };
    const password = pdfPassword.trim();
    if (password) {
      const { extractPdfText, pdfPasswordErrorKind } = await import("@/lib/pdf-text");
      let text: string;
      try {
        text = await extractPdfText(file, password);
      } catch (error) {
        const kind = pdfPasswordErrorKind(error);
        if (kind === "incorrect") throw new Error("La contraseña del PDF es incorrecta.");
        if (kind === "missing") throw new Error("Este PDF necesita contraseña. Revisá la que ingresaste.");
        throw error;
      }
      if (!text) {
        throw new Error("No se pudo leer texto del PDF (¿es una imagen escaneada?).");
      }
      requestBody = { pdfText: text };
    } else {
      requestBody = { pdfBase64: arrayBufferToBase64(await file.arrayBuffer()) };
    }

    const response = await fetch("/api/extract-pdf", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Caso típico: cartola de banco con contraseña pero sin clave ingresada.
      if (/password|protected|encrypt/i.test(errorText)) {
        throw new Error(
          "El PDF tiene contraseña. Ingresala en el campo 'Contraseña del PDF' y reprocesá el archivo.",
        );
      }
      throw new Error(errorText || "No se pudo procesar el PDF.");
    }

    const payload = await response.json() as Partial<ClaudePdfExtraction> & { error?: string };
    if (!Array.isArray(payload.movements)) {
      throw new Error(payload.error || "El servidor no devolvió movimientos válidos.");
    }

    return {
      payUntil: typeof payload.payUntil === "string" ? payload.payUntil : "",
      movements: payload.movements.map((movement) => ({
        date: typeof movement?.date === "string" ? movement.date : "",
        description: typeof movement?.description === "string" ? movement.description : "",
        amount: typeof movement?.amount === "number" ? movement.amount : Number(movement?.amount ?? NaN),
        installments: typeof movement?.installments === "string" ? movement.installments : "",
      })),
    };
  }, [pdfPassword]);

  const handleFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setCsvHeaders([]);
      setCsvRows([]);
      setPreviewRows([]);
      setIgnoredRowIds(new Set());
      setImportDueDate(null);
      setDetectedParser(null);

      if (file.name.toLowerCase().endsWith(".pdf")) {
        setPendingPdfFile(file); // guardamos el PDF para poder reprocesarlo con contraseña
        setIsPdfProcessing(true);
        try {
          const extracted = await parsePdfWithClaude(file);
          const rows = extracted.movements.map((movement) => ({
            [PDF_COLUMN_HEADERS.date]: parseDateValue(movement.date),
            [PDF_COLUMN_HEADERS.description]: movement.description?.trim() ?? "",
            [PDF_COLUMN_HEADERS.amount]: Number.isFinite(movement.amount) ? String(movement.amount) : "",
            [PDF_COLUMN_HEADERS.installments]: movement.installments?.trim() || "01/01",
          }));
          const headers = Object.values(PDF_COLUMN_HEADERS);
          const parser = resolveParser({
            fileName: file.name,
            headers,
            lines: [
              file.name,
              ...extracted.movements.map((movement) => movement.description),
            ],
            accountType: "credit",
            sourceKind: "pdf",
          });
          applyNormalizedImportRows(headers, rows, {
            detectedCreditImport: true,
            dueDate: parseDateValue(extracted.payUntil),
            parser,
            forceMapping: {
              date: PDF_COLUMN_HEADERS.date,
              description: PDF_COLUMN_HEADERS.description,
              amount: PDF_COLUMN_HEADERS.amount,
              installments: PDF_COLUMN_HEADERS.installments,
            },
          });
        } catch (error) {
          toast({
            title: "No se pudo procesar el PDF",
            description: error instanceof Error ? error.message : "Claude no pudo extraer los movimientos.",
            variant: "destructive",
          });
        } finally {
          setIsPdfProcessing(false);
        }
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) parseCSV(text, file.name);
      };
      reader.readAsText(file);
    },
    [applyNormalizedImportRows, parseCSV, parsePdfWithClaude, toast],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      const lowerName = file?.name.toLowerCase() ?? "";
      if (file && (lowerName.endsWith(".csv") || lowerName.endsWith(".txt") || lowerName.endsWith(".pdf"))) {
        void handleFile(file);
      } else {
        toast({
          title: "Formato no soportado",
          description: "Por favor sube un archivo CSV o PDF.",
          variant: "destructive",
        });
      }
    },
    [handleFile, toast],
  );

  // Resuelve la categoría (por nombre+tipo+ámbito) a su id, y de ahí los items (subcategorías) disponibles.
  const resolveCategoryId = (row: ParsedPreviewRow) => {
    const catType = row.type === "income" ? "income" : "expense";
    const byWs = categories.find(
      (c) => normalizeText(c.name) === normalizeText(row.category) && c.type === catType && (!c.workspace || c.workspace === row.workspace),
    );
    return (byWs ?? categories.find((c) => normalizeText(c.name) === normalizeText(row.category) && c.type === catType))?.id ?? null;
  };
  const itemsForRow = (row: ParsedPreviewRow) => {
    const catId = resolveCategoryId(row);
    return catId ? items.filter((item) => item.categoryId === catId) : [];
  };

  const updateRowCategory = (index: number, category: string) => {
    setPreviewRows((prev) => prev.map((row, rowIndex) => (
      // al cambiar la categoría a mano: se bloquea (categoryTouched) y se resetea la subcategoría.
      // El ámbito se re-sugiere solo si el humano no lo fijó antes.
      rowIndex === index ? {
        ...row,
        category,
        itemId: null,
        categoryTouched: true,
        workspace: row.workspaceTouched ? row.workspace : suggestWorkspace(row.name, category, row.type, accountType, defaultImportWorkspace),
      } : row
    )));
  };

  const updateRowItem = (index: number, itemId: string | null) => {
    setPreviewRows((prev) => prev.map((row, rowIndex) => (
      rowIndex === index ? { ...row, itemId, itemTouched: true } : row
    )));
  };

  const updateRowType = (index: number, type: "income" | "expense" | "credit_card_payment") => {
    setPreviewRows((prev) => {
      const next = prev.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        // Cambiar el tipo re-clasifica desde cero (suelta los locks: la categoría anterior ya no aplica).
        const classified = classifyPreviewRow({
          name: row.name, type, amount: row.amount, rules: movementRules, categories, accountType, defaultImportWorkspace,
        });
        return { ...row, type, category: classified.category, itemId: classified.itemId, workspace: classified.workspace, categoryTouched: false, itemTouched: false, workspaceTouched: false };
      });
      const seenInFile = new Set<string>();

      return next.map((row) => {
        if (row.error) return row;
        const storageType = accountType === "credit" ? "expense" : row.type;
        const key = `${row.date}__${row.name.trim().toLowerCase()}__${storageType}__${row.amount}`;
        const duplicateInFile = seenInFile.has(key);
        seenInFile.add(key);
        const duplicateAgainstExisting = existingKeys.has(key);
        return { ...row, duplicate: duplicateInFile || duplicateAgainstExisting };
      });
    });
  };

  const applyDefaultWorkspaceToAllRows = () => {
    setPreviewRows((prev) => prev.map((row) => ({
      ...row,
      workspaceTouched: true,
      workspace:
        row.type === "income"
          ? "business"
          : row.category === "Empresa"
            ? "business"
            : defaultImportWorkspace,
    })));
    toast({
      title: "Ámbito aplicado",
      description: `Se aplicó ${defaultImportWorkspace === "family" ? "Familia" : defaultImportWorkspace === "business" ? "Empresa" : "Consulta Dentista"} a la cartola.`,
    });
  };

  const updateRowWorkspace = (index: number, workspace: "business" | "family" | "dentist") => {
    setPreviewRows((prev) => prev.map((row, rowIndex) => (
      rowIndex === index ? { ...row, workspace, workspaceTouched: true } : row
    )));
  };

  const cycleCcMovementType = (index: number) => {
    setPreviewRows((prev) =>
      prev.map((row, rowIndex) => {
        if (rowIndex !== index || !row.ccMovementType) return row;
        const cycle: CcMovementType[] = ["purchase", "tc_payment", "reversal"];
        const next = cycle[(cycle.indexOf(row.ccMovementType) + 1) % cycle.length];
        const newType = getCreditPreviewType(next);
        // Cambiar el tipo del cargo re-clasifica desde cero (suelta los locks).
        const classified = classifyPreviewRow({
          name: row.name, type: newType, amount: row.amount, rules: movementRules, categories, accountType, defaultImportWorkspace,
        });
        return {
          ...row,
          ccMovementType: next,
          type: newType,
          category: classified.category,
          itemId: classified.itemId,
          workspace: classified.workspace,
          categoryTouched: false,
          itemTouched: false,
          workspaceTouched: false,
        };
      }),
    );
  };

  const removeRow = (index: number) => {
    const row = previewRows[index];
    if (row) {
      setIgnoredRowIds((current) => new Set(current).add(row.id));
    }
    setPreviewRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  const handleCreateCategory = () => {
    const name = newCategoryName.trim();
    if (!name) {
      toast({
        title: "Falta nombre",
        description: "Escribe un nombre para la categoría.",
        variant: "destructive",
      });
      return;
    }

    createCategoryMutation.mutate(
      {
        name,
        type: "expense",
        color: "#64748b",
        workspace: newCategoryWorkspace,
      },
      {
        onSuccess: () => {
          setNewCategoryName("");
          toast({
            title: "Categoría creada",
            description: "Ya quedó disponible aquí y en Configuración > Categorías.",
          });
        },
      },
    );
  };

  const rawPreviewRows = csvRows.slice(0, 5);
  const validRows = previewRows.filter((row) => !row.error);
  const duplicateCount = previewRows.filter((row) => row.duplicate).length;
  const invalidCount = previewRows.filter((row) => row.error).length;
  const purchaseRows = accountType === "credit"
    ? previewRows.filter((row) => !row.error && row.ccMovementType === "purchase")
    : [];
  const tcPaymentRows = accountType === "credit"
    ? previewRows.filter((row) => !row.error && row.ccMovementType === "tc_payment")
    : [];
  const reversalRows = accountType === "credit"
    ? previewRows.filter((row) => !row.error && row.ccMovementType === "reversal")
    : [];
  const purchaseTotal = purchaseRows.reduce((sum, row) => sum + row.amount, 0);
  const tcPaymentTotal = tcPaymentRows.reduce((sum, row) => sum + row.amount, 0);
  const importableCount = previewRows.filter(
    (row) => !row.error && row.ccMovementType !== "reversal",
  ).length;
  const expenseCategoryOptions = useMemo(() => {
    const names = new Set(
      categories
        .filter((category) => category.type === "expense")
        .map((category) => category.name),
    );

    getDefaultExpenseCategoryOptions().forEach((name) => names.add(name));
    return Array.from(names).sort((left, right) => left.localeCompare(right, "es"));
  }, [categories]);

  const importBatches = useMemo<ImportBatchSummary[]>(() => {
    const reviewBatches = reviewImportBatches.map((batch: ImportBatch): ImportBatchSummary => ({
      id: batch.id,
      label: batch.label,
      importedAt: batch.createdAt,
      cardName: batch.creditCardName,
      rows: batch.rowCount,
      totalAmount: batch.totalIncome + batch.totalExpense,
      status: batch.status,
      kind: "review",
    }));
    const grouped = new Map<string, ImportBatchSummary>();
    const reviewBatchIds = new Set(reviewBatches.map((batch) => batch.id));

    for (const transaction of transactions) {
      if (!transaction.importBatchId || !transaction.importedAt) continue;
      if (reviewBatchIds.has(transaction.importBatchId)) continue;

      const current = grouped.get(transaction.importBatchId);
      if (current) {
        current.rows += 1;
        current.totalAmount += transaction.amount;
        continue;
      }

      grouped.set(transaction.importBatchId, {
        id: transaction.importBatchId,
        label: transaction.importBatchLabel ?? "Importación",
        importedAt: transaction.importedAt,
        cardName: transaction.creditCardName ?? null,
        rows: 1,
        totalAmount: transaction.amount,
        kind: "legacy",
      });
    }

    return [...reviewBatches, ...Array.from(grouped.values())]
      .sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  }, [reviewImportBatches, transactions]);

  const latestImportBatchId = importBatches[0]?.id ?? null;
  const detailBatch = useMemo(
    () => importBatches.find((batch) => batch.id === detailBatchId) ?? null,
    [detailBatchId, importBatches],
  );
  const detailBatchTransactions = useMemo(
    () =>
      transactions
        .filter((transaction) => transaction.importBatchId === detailBatchId)
        .sort((left, right) => {
          if (left.date !== right.date) return right.date.localeCompare(left.date);
          return left.name.localeCompare(right.name);
        }),
    [detailBatchId, transactions],
  );
  const accountById = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, account])),
    [accounts],
  );

  const deleteImportBatch = (batch: ImportBatchSummary) => {
    if (batch.kind !== "legacy") {
      toast({
        title: "Carga en revisión",
        description: "Los lotes nuevos se gestionan desde la bandeja de movimientos.",
      });
      return;
    }

    const ids = transactions
      .filter((transaction) => transaction.importBatchId === batch.id)
      .map((transaction) => transaction.id);

    if (ids.length === 0) return;

    deleteImportMutation.mutate(ids, {
      onSuccess: (data: { deleted: number }) => {
        if (batchToDelete?.id === batch.id) {
          setBatchToDelete(null);
        }
        toast({
          title: "Importación eliminada",
          description: `${data.deleted} transacciones borradas del sistema.`,
        });
      },
    });
  };

  const updateImportedTransaction = (
    id: string,
    data: Partial<{ category: string; workspace: "business" | "family" | "dentist"; status: "paid" | "pending" }>,
  ) => {
    updateTransactionMutation.mutate(
      { id, data },
      {
        onSuccess: () => {
          toast({
            title: "Movimiento actualizado",
          });
        },
      },
    );
  };

  return (
    <div className={embedded ? "space-y-6" : "p-6 space-y-6 overflow-y-auto h-full"}>
      {!embedded && (
        <div className="flex items-center gap-3">
          <Upload className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">Importar Datos</h2>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            data-testid="dropzone"
          >
            <FileText className="size-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-base font-medium mb-1">
              {isPdfProcessing ? "Procesando PDF con Claude..." : "Arrastra tu archivo CSV o PDF aquí"}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {isPdfProcessing ? "Esto puede tardar 5-10 segundos." : "o haz clic para seleccionar"}
            </p>
            <input
              type="file"
              accept=".csv,.txt,.pdf"
              className="hidden"
              id="file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
              data-testid="input-file"
            />
            <Button
              variant="outline"
              onClick={() => document.getElementById("file-input")?.click()}
              disabled={isPdfProcessing}
              data-testid="button-select-file"
            >
              {isPdfProcessing ? "Procesando..." : "Seleccionar Archivo"}
            </Button>
          </div>

          {fileName && (
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <CheckCircle2 className="size-4 text-lime-500" />
              <span className="text-sm">
                Archivo cargado: <span className="font-medium">{fileName}</span>
              </span>
              {isPdfProcessing ? (
                <Badge variant="secondary" className="ml-auto">Procesando PDF...</Badge>
              ) : (
                <Badge variant="secondary" className="ml-auto">
                  {previewRows.length} filas detectadas
                </Badge>
              )}
              {detectedParser ? (
                <Badge variant="outline">
                  Parser: {detectedParser.label}
                </Badge>
              ) : null}
            </div>
          )}

          {/* Contraseña para cartolas protegidas (ej. Banco Edwards). */}
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Contraseña del PDF (opcional)</label>
              <Input
                type="password"
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                placeholder="Solo si tu cartola tiene clave"
                className="w-64"
                data-testid="input-pdf-password"
              />
            </div>
            {pendingPdfFile ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => handleFile(pendingPdfFile)}
                disabled={isPdfProcessing}
              >
                {isPdfProcessing ? "Procesando..." : "Reprocesar PDF"}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <AlertCircle className="size-4 text-muted-foreground" />
            Configuración de importación
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Tipo de cuenta</p>
            <Select value={accountType} onValueChange={(value) => setAccountType(value as AccountType)}>
              <SelectTrigger data-testid="select-account-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank">Cuenta corriente / vista</SelectItem>
                <SelectItem value="credit">Tarjeta de crédito</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {accountType === "credit" ? (
            <div>
              <p className="text-sm text-muted-foreground mb-2">Tarjeta asociada</p>
              {savedCards.length > 0 ? (
                <Select value={selectedCard} onValueChange={setSelectedCard}>
                  <SelectTrigger data-testid="select-credit-card">
                    <SelectValue placeholder="Seleccionar tarjeta" />
                  </SelectTrigger>
                  <SelectContent>
                    {savedCards.map((card) => (
                      <SelectItem key={card} value={card}>
                        {card}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={selectedCard}
                  onChange={(event) => setSelectedCard(event.target.value)}
                  placeholder="Nombre de la tarjeta"
                  data-testid="input-credit-card-name"
                />
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {selectedCreditCardDefaultAccount
                  ? `Cuenta de pago por defecto: ${selectedCreditCardDefaultAccount.name} — ${selectedCreditCardDefaultAccount.bank}`
                  : "Sin cuenta de pago por defecto vinculada para esta tarjeta."}
              </p>
            </div>
          ) : null}

          {accountType === "credit" ? (
            <div>
              <p className="text-sm text-muted-foreground mb-2">Ámbito por defecto</p>
              <Select value={defaultImportWorkspace} onValueChange={(value) => setDefaultImportWorkspace(value as ImportWorkspace)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="family">Familia</SelectItem>
                  <SelectItem value="business">Empresa</SelectItem>
                  <SelectItem value="dentist">Consulta Dentista</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {accountType === "bank" ? (
            <div>
              <p className="text-sm text-muted-foreground mb-2">¿De qué cuenta es esta cartola?</p>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger data-testid="select-import-bank-account">
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} — {account.bank}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div>
            <p className="text-sm text-muted-foreground mb-2">Columna fecha</p>
            <Select value={mapping.date} onValueChange={(value) => setMapping((prev) => ({ ...prev, date: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar" />
              </SelectTrigger>
              <SelectContent>
                {csvHeaders.map((header) => (
                  <SelectItem key={header} value={header}>{header}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-2">Columna descripción</p>
            <Select value={mapping.description} onValueChange={(value) => setMapping((prev) => ({ ...prev, description: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar" />
              </SelectTrigger>
              <SelectContent>
                {csvHeaders.map((header) => (
                  <SelectItem key={header} value={header}>{header}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-2">Columna monto</p>
            <Select value={mapping.amount} onValueChange={(value) => setMapping((prev) => ({ ...prev, amount: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar" />
              </SelectTrigger>
              <SelectContent>
                {csvHeaders.map((header) => (
                  <SelectItem key={header} value={header}>{header}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-2">Columna cuotas</p>
            <Select value={mapping.installments} onValueChange={(value) => setMapping((prev) => ({ ...prev, installments: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Opcional" />
              </SelectTrigger>
              <SelectContent>
                {csvHeaders.map((header) => (
                  <SelectItem key={header} value={header}>{header}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {accountType === "credit" ? (
            <div className="md:col-span-2 xl:col-span-4 flex justify-end">
              <Button variant="outline" onClick={applyDefaultWorkspaceToAllRows}>
                Aplicar ámbito por defecto a la cartola
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Crear categoría desde importación</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_200px_auto]">
          <Input
            value={newCategoryName}
            onChange={(event) => setNewCategoryName(event.target.value)}
            placeholder="Ej: Otros personales"
          />
          <Select value={newCategoryWorkspace} onValueChange={(value) => setNewCategoryWorkspace(value as "business" | "family" | "dentist")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="business">Empresa</SelectItem>
              <SelectItem value="family">Familia</SelectItem>
              <SelectItem value="dentist">Consulta Dentista</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleCreateCategory} disabled={createCategoryMutation.isPending}>
            {createCategoryMutation.isPending ? "Creando..." : "Crear categoría"}
          </Button>
        </CardContent>
      </Card>

      {!embedded && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Últimas cargas</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Carga</TableHead>
                <TableHead>Tarjeta</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Filas</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importBatches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    Aún no hay cargas registradas.
                  </TableCell>
                </TableRow>
              ) : importBatches.slice(0, 10).map((batch) => {
                const isLatest = batch.id === latestImportBatchId;
                return (
                  <TableRow key={batch.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{batch.label}</span>
                        {isLatest ? <Badge variant="secondary">Última</Badge> : null}
                        {batch.kind === "review" && batch.status ? (
                          <Badge className={importBatchStatusTone(batch.status)}>
                            {IMPORT_BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{batch.cardName ?? "-"}</TableCell>
                    <TableCell>{batch.importedAt.slice(0, 16).replace("T", " ")}</TableCell>
                    <TableCell className="text-right tabular-nums">{batch.rows}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(batch.totalAmount)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (batch.kind === "review") {
                              navigate(`/movements?batch=${encodeURIComponent(batch.id)}`);
                              return;
                            }
                            setDetailBatchId(batch.id);
                          }}
                        >
                          {batch.kind === "review" ? "Revisar" : "Ver detalle"}
                        </Button>
                        {batch.kind === "legacy" ? (
                          <Button
                            variant={isLatest ? "destructive" : "outline"}
                            size="sm"
                            onClick={() => setBatchToDelete(batch)}
                            disabled={deleteImportMutation.isPending}
                          >
                            Eliminar lote
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Preview crudo: primeras 5 filas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Para tarjetas de crédito, el signo no define ingreso o gasto: se usa para detectar reversas y pagos TC, mientras las compras siguen entrando como gastos pendientes.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {csvHeaders.length > 0 ? csvHeaders.map((header) => (
                    <TableHead key={header}>{header}</TableHead>
                  )) : (
                    <TableHead>Sin datos cargados</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rawPreviewRows.length > 0 ? rawPreviewRows.map((row, index) => (
                  <TableRow key={index}>
                    {csvHeaders.map((header) => (
                      <TableCell key={`${index}-${header}`} className="text-sm">
                        {row[header]}
                      </TableCell>
                    ))}
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell className="text-sm text-muted-foreground">Carga un archivo para ver la muestra.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!batchToDelete} onOpenChange={(open) => { if (!open) setBatchToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar lote importado</AlertDialogTitle>
            <AlertDialogDescription>
              {batchToDelete
                ? `¿Eliminar ${batchToDelete.rows} transacciones de este lote? También desaparecerán de Resumen y de las demás vistas que usan esas transacciones.`
                : "Confirma la eliminación del lote."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (batchToDelete) deleteImportBatch(batchToDelete);
              }}
            >
              Eliminar carga
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!detailBatch} onOpenChange={(open) => { if (!open) setDetailBatchId(null); }}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Detalle del lote</DialogTitle>
            <DialogDescription>
              {detailBatch
                ? `${detailBatch.label} · ${detailBatch.rows} transacción${detailBatch.rows === 1 ? "" : "es"}`
                : "Revisa y edita los movimientos de esta importación."}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-x-auto">
            <Table className="zebra-stripe">
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Ámbito</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Cuenta/tarjeta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailBatchTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Este lote no tiene transacciones disponibles.
                    </TableCell>
                  </TableRow>
                ) : detailBatchTransactions.map((transaction) => {
                  const linkedAccount = transaction.accountId ? accountById[transaction.accountId] : null;
                  const accountOrCardLabel = linkedAccount
                    ? `${linkedAccount.name} — ${linkedAccount.bank}`
                    : transaction.creditCardName ?? "-";

                  return (
                    <TableRow key={transaction.id}>
                      <TableCell className="tabular-nums text-sm">{transaction.date}</TableCell>
                      <TableCell className="text-sm font-medium">{transaction.name}</TableCell>
                      <TableCell>
                        <Select
                          value={transaction.category}
                          onValueChange={(value) => updateImportedTransaction(transaction.id, { category: value })}
                        >
                          <SelectTrigger className="w-44 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.name}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={transaction.workspace ?? "business"}
                          onValueChange={(value) =>
                            updateImportedTransaction(transaction.id, { workspace: value as "business" | "family" | "dentist" })
                          }
                        >
                          <SelectTrigger className="w-36 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="business">Empresa</SelectItem>
                            <SelectItem value="family">Familia</SelectItem>
                            <SelectItem value="dentist">Consulta Dentista</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className={`text-right tabular-nums text-sm font-medium ${transaction.type === "income" ? "text-[hsl(var(--money-in))]" : "text-[#e3e3ea]"}`}>
                        {transaction.type === "income" ? "+" : "-"}
                        {formatCLP(transaction.amount)}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={transaction.status}
                          onValueChange={(value) =>
                            updateImportedTransaction(transaction.id, { status: value as "paid" | "pending" })
                          }
                        >
                          <SelectTrigger className="w-32 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="paid">Pagado</SelectItem>
                            <SelectItem value="pending">Pendiente</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm">{accountOrCardLabel}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {previewRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base font-semibold">
                Vista previa normalizada ({previewRows.length} filas)
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{validRows.length} válidas</Badge>
                <Badge variant="outline">{duplicateCount} duplicadas</Badge>
                <Badge variant="outline">{invalidCount} inválidas</Badge>
                <Button
                  onClick={handleImport}
                  disabled={importMutation.isPending}
                  data-testid="button-import"
                >
                  {importMutation.isPending ? "Enviando..." : `Enviar ${importableCount} a revisión`}
                </Button>
              </div>
            </div>
          </CardHeader>
          {accountType === "credit" && previewRows.length > 0 && (
            <div className="px-6 pb-4">
              <div className="rounded-lg border bg-muted/40 p-4 text-sm space-y-1.5">
                <p className="font-medium text-muted-foreground mb-2">Resumen de importación</p>
                <div className="flex items-center justify-between">
                  <span>{purchaseRows.length} compras</span>
                  <span className="tabular-nums font-medium">{formatCLP(purchaseTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{tcPaymentRows.length} pagos TC <span className="text-muted-foreground text-xs">(excluidos de gastos)</span></span>
                  <span className="tabular-nums font-medium">{formatCLP(tcPaymentTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{reversalRows.length} reversas detectadas <span className="text-muted-foreground text-xs">(no se enviarán)</span></span>
                  <span className="tabular-nums text-muted-foreground">—</span>
                </div>
                {importDueDate && (
                  <div className="flex items-center justify-between pt-1 border-t mt-1">
                    <span className="font-medium">Fecha límite de pago</span>
                    <span className="tabular-nums font-medium text-zinc-600 dark:text-zinc-400">{importDueDate}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table className="zebra-stripe" data-testid="table-preview">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Fecha</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Cuotas</TableHead>
                    {accountType === "credit" ? <TableHead>Tipo TC</TableHead> : null}
                    <TableHead>Tipo</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Subcategoría</TableHead>
                    <TableHead>Ámbito</TableHead>
                    <TableHead>Validación</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right pr-5">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, index) => (
                    <TableRow key={row.id} className={row.ccMovementType === "reversal" ? "opacity-50 line-through" : ""}>
                      {(() => {
                        const effectiveCategory = row.category || suggestRowCategory(row.name, row.type, categories);
                        return (
                          <>
                      <TableCell className="pl-5 tabular-nums text-sm">{row.date}</TableCell>
                      <TableCell className="text-sm font-medium">
                        <div className="space-y-1">
                          <div>{row.name}</div>
                          {accountType === "credit" ? (
                            <p className="text-xs text-muted-foreground">
                              Tarjeta: {selectedCard.trim() || "por seleccionar"}
                            </p>
                          ) : null}
                          {accountType === "credit" && row.ccMovementType === "tc_payment" ? (
                            <p className="text-xs text-muted-foreground">
                              {selectedCreditCardDefaultAccount
                                ? `Cuenta origen: ${selectedCreditCardDefaultAccount.name} — ${selectedCreditCardDefaultAccount.bank}`
                                : "Cuenta origen: sin vínculo por defecto"}
                            </p>
                          ) : null}
                          {row.error && <p className="text-xs text-[#e3e3ea]">{row.error}</p>}
                          {row.ccMovementType === "tc_payment" && row.duplicate && !row.error ? (
                            <p className="text-xs text-zinc-600 dark:text-zinc-400">
                              Pago TC ya registrado — se enviará como duplicado para revisar
                            </p>
                          ) : null}
                          {row.ccMovementType === "reversal" && !row.error && (
                            <p className="text-xs text-yellow-600 dark:text-yellow-400">Reversa detectada — no se enviará</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{row.installmentsLabel}</TableCell>
                      {accountType === "credit" ? (
                        <TableCell>
                          {row.ccMovementType === "purchase" && (
                            <button
                              type="button"
                              onClick={() => cycleCcMovementType(index)}
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300 cursor-pointer hover:opacity-80 transition-opacity"
                              title="Clic para cambiar tipo"
                            >
                              Compra
                            </button>
                          )}
                          {row.ccMovementType === "tc_payment" && (
                            <button
                              type="button"
                              onClick={() => cycleCcMovementType(index)}
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300 cursor-pointer hover:opacity-80 transition-opacity"
                              title="Clic para cambiar tipo"
                            >
                              Pago TC
                            </button>
                          )}
                          {row.ccMovementType === "reversal" && (
                            <button
                              type="button"
                              onClick={() => cycleCcMovementType(index)}
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-700 cursor-pointer hover:opacity-80 transition-opacity"
                              title="Clic para cambiar tipo"
                            >
                              Reversa
                            </button>
                          )}
                          {!row.ccMovementType && null}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        {accountType === "credit" ? (
                          <Badge variant="outline" className="h-8 px-3 text-xs font-medium">
                            {row.ccMovementType === "tc_payment" ? "Pago tarjeta" : "Gasto"}
                          </Badge>
                        ) : (
                          <Select
                            value={row.type}
                            onValueChange={(value) => updateRowType(index, value as "income" | "expense" | "credit_card_payment")}
                            disabled={Boolean(row.error)}
                          >
                            <SelectTrigger className="w-28 h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="income">Ingreso</SelectItem>
                              <SelectItem value="expense">Gasto</SelectItem>
                              <SelectItem value="credit_card_payment">Pago tarjeta</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const categoryOptionsForRow = row.type === "income"
                            ? categories
                                .filter((category) => category.type === "income")
                                .map((category) => category.name)
                            : expenseCategoryOptions;
                          const mergedCategoryOptions = effectiveCategory && !categoryOptionsForRow.includes(effectiveCategory)
                            ? [effectiveCategory, ...categoryOptionsForRow]
                            : categoryOptionsForRow;

                          return (
                        <Select
                          value={effectiveCategory}
                          onValueChange={(value) => updateRowCategory(index, value)}
                          disabled={Boolean(row.error)}
                        >
                          <SelectTrigger className="w-44 h-8 text-xs">
                            <SelectValue placeholder={effectiveCategory || "Seleccionar categoría"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Sin categoría">Sin categoría</SelectItem>
                            {mergedCategoryOptions.map((categoryName) => (
                              <SelectItem key={categoryName} value={categoryName}>
                                {categoryName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                          </Select>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const rowItems = itemsForRow(row);
                          if (rowItems.length === 0) {
                            return <span className="text-xs text-muted-foreground">—</span>;
                          }
                          return (
                            <Select
                              value={row.itemId ?? "__none__"}
                              onValueChange={(value) => updateRowItem(index, value === "__none__" ? null : value)}
                              disabled={Boolean(row.error)}
                            >
                              <SelectTrigger className="w-44 h-8 text-xs">
                                <SelectValue placeholder="Subcategoría" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Sin subcategoría</SelectItem>
                                {rowItems.map((item) => (
                                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.workspace}
                          onValueChange={(value) => updateRowWorkspace(index, value as "business" | "family" | "dentist")}
                          disabled={Boolean(row.error)}
                        >
                          <SelectTrigger className="w-40 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="business">Empresa</SelectItem>
                            <SelectItem value="family">Familia</SelectItem>
                            <SelectItem value="dentist">Consulta Dentista</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {row.error ? (
                          <Badge variant="outline">Inválida</Badge>
                        ) : row.duplicate ? (
                          <Badge variant="outline" className="text-zinc-700 dark:text-zinc-300">
                            Duplicada
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Importable</Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums text-sm font-medium ${
                          row.type === "income" ? "text-[hsl(var(--money-in))]" : "text-[#e3e3ea]"
                        }`}
                      >
                        {row.type === "income" ? "+" : "-"}
                        {formatCLP(row.amount)}
                      </TableCell>
                      <TableCell className="text-right pr-5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => removeRow(index)}
                        >
                          <X className="size-3.5 text-muted-foreground" />
                        </Button>
                      </TableCell>
                          </>
                        );
                      })()}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <AlertCircle className="size-4 text-muted-foreground" />
            Formato esperado del CSV
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Debe existir al menos una columna para fecha, descripción y monto. En tarjeta de crédito, la app usa el signo solo como ayuda para detectar reversas, pero no para convertir compras en ingresos.
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            La app ahora sugiere categorías en base a la descripción: por ejemplo `Uber Eats` y `Uber Trip` van a `Comida`, y `Intereses` o `Comisión` se agrupan automáticamente como cargos bancarios.
          </p>
          <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs">
            <p>Fecha;Descripción;Monto</p>
            <p>15/01/2026;Pago Cliente ABC;450000</p>
            <p>18/01/2026;Arriendo Oficina;-350000</p>
            <p>20/01/2026;Pago Tarjeta;-45000</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
