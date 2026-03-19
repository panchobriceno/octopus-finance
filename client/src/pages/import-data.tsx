import { useCallback, useEffect, useMemo, useState } from "react";
import { useCategories, useBulkCreateTransactions, useCreateCategory, useTransactions } from "@/lib/hooks";
import { getCreditCards } from "@/lib/credit-cards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type AccountType = "bank" | "credit";

const SUGGESTED_FAMILY_EXPENSE_CATEGORIES = [
  "Comida",
  "Seguros",
  "Otros",
  "Intereses bancarios",
  "Comisiones bancarias",
  "Viajes",
  "Transporte",
  "Pago tarjeta",
];

interface ParsedPreviewRow {
  id: string;
  date: string;
  name: string;
  amount: number;
  type: "income" | "expense" | "credit_card_payment";
  category: string;
  installmentsLabel: string;
  installmentCount: number | null;
  duplicate: boolean;
  error?: string;
}

interface ColumnMapping {
  date: string;
  description: string;
  amount: string;
  installments: string;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function scoreHeaderCell(value: string) {
  const normalized = normalizeText(value);

  if (!normalized) return 0;
  if (normalized.includes("fecha")) return 3;
  if (normalized.includes("descripcion") || normalized.includes("descripción")) return 3;
  if (normalized.includes("monto")) return 3;
  if (normalized.includes("cuota")) return 2;
  if (normalized.includes("categoria")) return 1;
  return 0;
}

function findCategoryName(categories: { name: string; type: string; workspace?: string | null }[], name: string, workspace: "family" | "business" = "family") {
  return categories.find((category) =>
    category.type === "expense" &&
    category.name.toLowerCase() === name.toLowerCase() &&
    (category.workspace ?? "business") === workspace,
  )?.name;
}

function suggestExpenseCategory(
  description: string,
  categories: { name: string; type: string; workspace?: string | null }[],
) {
  const normalized = normalizeText(description);

  if (normalized.includes("uber eats") || normalized.includes("uber trip")) {
    return findCategoryName(categories, "Comida") ?? "Comida";
  }

  if (
    normalized.includes("seguros") ||
    normalized.includes("seguro") ||
    normalized.includes("kushkiseguros") ||
    normalized.includes("banchile seguros")
  ) {
    return findCategoryName(categories, "Seguros") ?? "Seguros";
  }

  if (normalized.includes("intereses")) {
    return findCategoryName(categories, "Intereses bancarios") ?? "Intereses bancarios";
  }

  if (
    normalized.includes("comision") ||
    normalized.includes("mantencion") ||
    normalized.includes("impuesto decreto ley 3475")
  ) {
    return findCategoryName(categories, "Comisiones bancarias") ?? "Comisiones bancarias";
  }

  if (
    normalized.includes("american airlines") ||
    normalized.includes("airlines") ||
    normalized.includes("sky") ||
    normalized.includes("latam") ||
    normalized.includes("travel")
  ) {
    return findCategoryName(categories, "Viajes") ?? findCategoryName(categories, "Otros") ?? "Otros";
  }

  if (
    normalized.includes("mercadopago") ||
    normalized.includes("mercado") ||
    normalized.includes("aliexpress") ||
    normalized.includes("apple.com") ||
    normalized.includes("paris")
  ) {
    return findCategoryName(categories, "Otros") ?? "Otros";
  }

  if (
    normalized.includes("pago pesos") ||
    normalized.includes("pago pap") ||
    normalized.includes("tef")
  ) {
    return findCategoryName(categories, "Pago tarjeta") ?? "Pago tarjeta";
  }

  return findCategoryName(categories, "Otros") ?? "Otros";
}

function suggestRowCategory(
  name: string,
  type: "income" | "expense" | "credit_card_payment",
  categories: { name: string; type: string; workspace?: string | null }[],
) {
  if (type === "credit_card_payment") {
    return findCategoryName(categories, "Pago tarjeta") ?? "Pago tarjeta";
  }

  if (type === "income") {
    return categories.find((category) => category.type === "income")?.name ?? "Sin categoría";
  }

  return suggestExpenseCategory(name, categories);
}

function suggestRowType(name: string, fallbackType: "income" | "expense") {
  const normalized = normalizeText(name);

  if (
    normalized.includes("pago pesos") ||
    normalized.includes("pago pap") ||
    normalized.includes("tef") ||
    normalized.includes("traspaso deuda")
  ) {
    return "credit_card_payment" as const;
  }

  return fallbackType;
}

function splitCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values.map((value) => value.replace(/^["']|["']$/g, ""));
}

function parseDateValue(value: string) {
  const raw = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;

  const dashMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dashMatch) return `${dashMatch[3]}-${dashMatch[2]}-${dashMatch[1]}`;

  return "";
}

function parseAmountValue(value: string) {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/\$/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(/,/g, ".");

  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : NaN;
}

function parseInstallmentsValue(value: string) {
  const raw = value.trim();

  if (!raw) {
    return { label: "-", count: null as number | null };
  }

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    return { label: raw, count: null as number | null };
  }

  return {
    label: `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}`,
    count: Number.parseInt(match[2], 10),
  };
}

function inferMapping(headers: string[]): ColumnMapping {
  const match = (patterns: string[]) =>
    headers.find((header) => patterns.some((pattern) => header.toLowerCase().includes(pattern))) ?? headers[0] ?? "";

  return {
    date: match(["fecha", "date"]),
    description: match(["descripcion", "descripción", "detalle", "glosa", "nombre", "description"]),
    amount: match(["monto", "amount", "importe", "valor"]),
    installments: match(["cuota", "cuotas", "installment"]),
  };
}

function detectHeaderRowIndex(lines: string[], delimiter: string) {
  let bestIndex = 0;
  let bestScore = -1;

  lines.forEach((line, index) => {
    const score = splitCsvLine(line, delimiter).reduce((sum, cell) => sum + scoreHeaderCell(cell), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export default function ImportDataPage() {
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [previewRows, setPreviewRows] = useState<ParsedPreviewRow[]>([]);
  const [ignoredRowIds, setIgnoredRowIds] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>("bank");
  const [mapping, setMapping] = useState<ColumnMapping>({ date: "", description: "", amount: "", installments: "" });
  const [savedCards, setSavedCards] = useState<string[]>([]);
  const [selectedCard, setSelectedCard] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryWorkspace, setNewCategoryWorkspace] = useState<"business" | "family" | "dentist">("family");
  const { toast } = useToast();

  const { data: categories = [] } = useCategories();
  const { data: transactions = [] } = useTransactions();
  const importMutation = useBulkCreateTransactions();
  const createCategoryMutation = useCreateCategory();

  const existingKeys = useMemo(() => new Set(
    transactions
      .filter((tx) => tx.status !== "cancelled")
      .map((tx) => `${tx.date}__${tx.name.trim().toLowerCase()}__${tx.type}__${tx.amount}`),
  ), [transactions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncCards = () => {
      const cards = getCreditCards();
      setSavedCards(cards);
      setSelectedCard((current) => current || cards[0] || "");
    };
    syncCards();
    window.addEventListener("octopus-credit-cards-updated", syncCards);
    return () => window.removeEventListener("octopus-credit-cards-updated", syncCards);
  }, []);

  useEffect(() => {
    if (!csvRows.length || !mapping.date || !mapping.description || !mapping.amount) {
      setPreviewRows([]);
      return;
    }

    const nextRows: ParsedPreviewRow[] = csvRows.map((row, index) => {
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
          installmentsLabel: installments.label,
          installmentCount: installments.count,
          duplicate: false,
          error: "Fila inválida. Revisa fecha, descripción o monto.",
        };
      }

      const normalizedAmount = accountType === "credit" ? rawAmount * -1 : rawAmount;
      const inferredType = normalizedAmount >= 0 ? "income" : "expense";
      const type = suggestRowType(name, inferredType);
      const amount = Math.abs(normalizedAmount);
      const key = `${date}__${name.toLowerCase()}__${type}__${amount}`;

      return {
        id: rowId,
        date,
        name,
        amount,
        type,
        category: suggestRowCategory(name, type, categories),
        installmentsLabel: installments.label,
        installmentCount: installments.count,
        duplicate: existingKeys.has(key),
      };
    }).filter((row): row is ParsedPreviewRow => row !== null);

    const seenInFile = new Set<string>();
    const dedupedRows = nextRows.map((row) => {
      if (row.error) return row;

      const key = `${row.date}__${row.name.trim().toLowerCase()}__${row.type}__${row.amount}`;
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

        const preservedType = previous.error ? row.type : previous.type;
        const duplicate = existingKeys.has(
          `${row.date}__${row.name.trim().toLowerCase()}__${preservedType}__${row.amount}`,
        );

        return {
          ...row,
          category: previous.category === "Sin categoría"
            ? suggestRowCategory(row.name, row.type, categories)
            : (previous.category || suggestRowCategory(row.name, row.type, categories)),
          installmentsLabel: previous.installmentsLabel || row.installmentsLabel,
          installmentCount: previous.installmentCount ?? row.installmentCount,
          type: preservedType,
          duplicate: row.duplicate || duplicate,
        };
      }),
    );
  }, [csvRows, mapping, accountType, existingKeys, ignoredRowIds, categories]);

  const handleImport = () => {
    const importableRows = previewRows.filter((row) => !row.error && !row.duplicate);

    if (importableRows.length === 0) {
      toast({
        title: "No hay filas para importar",
        description: "Corrige las filas inválidas o elimina duplicados.",
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

    const mapped = importableRows.map((row) => ({
      name: row.name,
      category: row.category,
      amount: row.amount,
      type: row.type,
      date: row.date,
      notes: null,
      subtype: "actual" as const,
      status: "paid" as const,
      itemId: null,
      workspace: "business" as const,
      movementType:
        row.type === "income"
          ? "income" as const
          : row.type === "credit_card_payment"
            ? "credit_card_payment" as const
            : "expense" as const,
      paymentMethod:
        accountType === "credit" && row.type === "expense"
          ? "credit_card" as const
          : "bank_account" as const,
      destinationWorkspace: null,
      creditCardName: accountType === "credit" ? selectedCard.trim() : null,
      installmentCount: accountType === "credit" && row.type === "expense" ? row.installmentCount : null,
    }));

    importMutation.mutate(mapped, {
      onSuccess: (data) => {
        toast({
          title: "Importación exitosa",
          description: `${data.imported} filas importadas. ${previewRows.length - data.imported} filas fueron omitidas.`,
        });
        setCsvHeaders([]);
        setCsvRows([]);
        setPreviewRows([]);
        setIgnoredRowIds(new Set());
        setFileName("");
      },
    });
  };

  const parseCSV = useCallback(
    (text: string) => {
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

      setIgnoredRowIds(new Set());
      setCsvHeaders(headers);
      setCsvRows(rows);
      setMapping(inferMapping(headers));
    },
    [toast],
  );

  const handleFile = useCallback(
    (file: File) => {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) parseCSV(text);
      };
      reader.readAsText(file);
    },
    [parseCSV],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".csv") || file.name.endsWith(".txt"))) {
        handleFile(file);
      } else {
        toast({
          title: "Formato no soportado",
          description: "Por favor sube un archivo CSV.",
          variant: "destructive",
        });
      }
    },
    [handleFile, toast],
  );

  const updateRowCategory = (index: number, category: string) => {
    setPreviewRows((prev) => prev.map((row, rowIndex) => (
      rowIndex === index ? { ...row, category } : row
    )));
  };

  const updateRowType = (index: number, type: "income" | "expense" | "credit_card_payment") => {
    setPreviewRows((prev) => {
      const next = prev.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        return { ...row, type, category: suggestRowCategory(row.name, type, categories) };
      });
      const seenInFile = new Set<string>();

      return next.map((row) => {
        if (row.error) return row;
        const key = `${row.date}__${row.name.trim().toLowerCase()}__${row.type}__${row.amount}`;
        const duplicateInFile = seenInFile.has(key);
        seenInFile.add(key);
        const duplicateAgainstExisting = existingKeys.has(key);
        return { ...row, duplicate: duplicateInFile || duplicateAgainstExisting };
      });
    });
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
  const expenseCategoryOptions = useMemo(() => {
    const names = new Set(
      categories
        .filter((category) => category.type === "expense")
        .map((category) => category.name),
    );

    SUGGESTED_FAMILY_EXPENSE_CATEGORIES.forEach((name) => names.add(name));
    return Array.from(names).sort((left, right) => left.localeCompare(right, "es"));
  }, [categories]);

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <Upload className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Importar Datos</h2>
      </div>

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
            <p className="text-base font-medium mb-1">Arrastra tu archivo CSV aquí</p>
            <p className="text-sm text-muted-foreground mb-4">o haz clic para seleccionar</p>
            <input
              type="file"
              accept=".csv,.txt"
              className="hidden"
              id="file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              data-testid="input-file"
            />
            <Button
              variant="outline"
              onClick={() => document.getElementById("file-input")?.click()}
              data-testid="button-select-file"
            >
              Seleccionar Archivo
            </Button>
          </div>

          {fileName && (
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <CheckCircle2 className="size-4 text-emerald-500" />
              <span className="text-sm">
                Archivo cargado: <span className="font-medium">{fileName}</span>
              </span>
              <Badge variant="secondary" className="ml-auto">
                {previewRows.length} filas detectadas
              </Badge>
            </div>
          )}
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Preview crudo: primeras 5 filas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Para tarjetas de crédito se invierten los signos antes de construir la vista previa.
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
                  {importMutation.isPending ? "Importando..." : `Importar ${validRows.length - duplicateCount} filas`}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table className="zebra-stripe" data-testid="table-preview">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Fecha</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Cuotas</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right pr-5">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, index) => (
                    <TableRow key={row.id}>
                      <TableCell className="pl-5 tabular-nums text-sm">{row.date}</TableCell>
                      <TableCell className="text-sm font-medium">
                        <div className="space-y-1">
                          <div>{row.name}</div>
                          {row.error && <p className="text-xs text-red-600 dark:text-red-400">{row.error}</p>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{row.installmentsLabel}</TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.category}
                          onValueChange={(value) => updateRowCategory(index, value)}
                          disabled={Boolean(row.error)}
                        >
                          <SelectTrigger className="w-44 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Sin categoría">Sin categoría</SelectItem>
                            {(row.type === "income"
                              ? categories
                                  .filter((category) => category.type === "income")
                                  .map((category) => category.name)
                              : expenseCategoryOptions
                            ).map((categoryName) => (
                              <SelectItem key={categoryName} value={categoryName}>
                                {categoryName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {row.error ? (
                          <Badge variant="outline">Inválida</Badge>
                        ) : row.duplicate ? (
                          <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
                            Duplicada
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Lista</Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums text-sm font-medium ${
                          row.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
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
            Debe existir al menos una columna para fecha, descripción y monto. Para tarjeta de crédito los signos se invierten automáticamente.
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
