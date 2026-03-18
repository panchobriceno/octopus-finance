import { useState, useCallback } from "react";
import { useCategories, useBulkCreateTransactions } from "@/lib/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, CheckCircle2, AlertCircle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface ParsedRow {
  date: string;
  name: string;
  amount: number;
  type: "income" | "expense";
  category: string;
}

export default function ImportDataPage() {
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();

  const { data: categories = [] } = useCategories();

  const importMutation = useBulkCreateTransactions();

  const handleImport = () => {
    const mapped = parsedRows.map((r) => ({
      name: r.name,
      category: r.category,
      amount: Math.abs(r.amount),
      type: r.type,
      date: r.date,
      notes: null,
      subtype: "actual" as const,
      status: "paid" as const,
      itemId: null,
    }));
    importMutation.mutate(mapped, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: ["items"] });
        toast({
          title: "Importación exitosa",
          description: `${data.imported} de ${data.total} transacciones importadas.`,
        });
        setParsedRows([]);
        setFileName("");
      },
    });
  };

  const parseCSV = useCallback(
    (text: string) => {
      const lines = text.trim().split("\n");
      if (lines.length < 2) return;

      // Try to detect header
      const header = lines[0].toLowerCase();
      const hasHeader =
        header.includes("fecha") ||
        header.includes("date") ||
        header.includes("monto") ||
        header.includes("amount") ||
        header.includes("descripcion") ||
        header.includes("nombre");

      const dataLines = hasHeader ? lines.slice(1) : lines;
      const rows: ParsedRow[] = [];

      for (const line of dataLines) {
        if (!line.trim()) continue;

        // Handle both comma and semicolon delimiters
        const sep = line.includes(";") ? ";" : ",";
        const parts = line.split(sep).map((p) => p.trim().replace(/^["']|["']$/g, ""));

        if (parts.length < 3) continue;

        let date = "";
        let name = "";
        let amount = 0;

        for (let i = 0; i < parts.length; i++) {
          const val = parts[i];

          // Try to detect date (DD/MM/YYYY or YYYY-MM-DD or DD-MM-YYYY)
          if (!date) {
            const dateMatch = val.match(
              /^(\d{4})-(\d{2})-(\d{2})$|^(\d{2})\/(\d{2})\/(\d{4})$|^(\d{2})-(\d{2})-(\d{4})$/
            );
            if (dateMatch) {
              if (dateMatch[1]) {
                date = val;
              } else if (dateMatch[4]) {
                date = `${dateMatch[6]}-${dateMatch[5]}-${dateMatch[4]}`;
              } else if (dateMatch[7]) {
                date = `${dateMatch[9]}-${dateMatch[8]}-${dateMatch[7]}`;
              }
              continue;
            }
          }

          // Try to detect amount
          const numVal = parseFloat(val.replace(/\./g, "").replace(",", "."));
          if (!isNaN(numVal) && val.match(/[\d,.]+/)) {
            amount = numVal;
            continue;
          }

          // Otherwise it's a name/description
          if (!name && val.length > 1) {
            name = val;
          }
        }

        if (date && name && amount !== 0) {
          rows.push({
            date,
            name,
            amount: Math.abs(amount),
            type: amount >= 0 ? "income" : "expense",
            category: "Sin categoría",
          });
        }
      }

      setParsedRows(rows);
    },
    []
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
    [parseCSV]
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
    [handleFile, toast]
  );

  const updateRowCategory = (index: number, category: string) => {
    setParsedRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, category } : r))
    );
  };

  const updateRowType = (index: number, type: "income" | "expense") => {
    setParsedRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, type } : r))
    );
  };

  const removeRow = (index: number) => {
    setParsedRows((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <Upload className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Importar Datos</h2>
      </div>

      {/* Drop Zone */}
      <Card>
        <CardContent className="pt-6">
          <div
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
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
              Arrastra tu archivo CSV aquí
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              o haz clic para seleccionar
            </p>
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
            <div className="flex items-center gap-2 mt-4">
              <CheckCircle2 className="size-4 text-emerald-500" />
              <span className="text-sm">
                Archivo cargado: <span className="font-medium">{fileName}</span>
              </span>
              <Badge variant="secondary" className="ml-auto">
                {parsedRows.length} filas detectadas
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Format Guide */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <AlertCircle className="size-4 text-muted-foreground" />
            Formato esperado del CSV
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Tu archivo CSV debe contener al menos 3 columnas: fecha, descripción
            y monto. Los montos negativos se interpretan como gastos.
          </p>
          <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs">
            <p>Fecha;Descripción;Monto</p>
            <p>15/01/2026;Pago Cliente ABC;450000</p>
            <p>18/01/2026;Arriendo Oficina;-350000</p>
            <p>20/01/2026;Adobe CC;-45000</p>
          </div>
        </CardContent>
      </Card>

      {/* Preview Table */}
      {parsedRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Vista Previa ({parsedRows.length} transacciones)
              </CardTitle>
              <Button
                onClick={handleImport}
                disabled={importMutation.isPending}
                data-testid="button-import"
              >
                {importMutation.isPending
                  ? "Importando..."
                  : `Importar ${parsedRows.length} transacciones`}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table className="zebra-stripe" data-testid="table-preview">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Fecha</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right pr-5">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-5 tabular-nums text-sm">
                        {row.date}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {row.name}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.type}
                          onValueChange={(v) =>
                            updateRowType(i, v as "income" | "expense")
                          }
                        >
                          <SelectTrigger className="w-28 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="income">Ingreso</SelectItem>
                            <SelectItem value="expense">Gasto</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.category}
                          onValueChange={(v) => updateRowCategory(i, v)}
                        >
                          <SelectTrigger className="w-40 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Sin categoría">
                              Sin categoría
                            </SelectItem>
                            {categories
                              .filter((c) => c.type === row.type)
                              .map((cat) => (
                                <SelectItem key={cat.id} value={cat.name}>
                                  {cat.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums text-sm font-medium ${
                          row.type === "income"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {row.type === "income" ? "+" : "-"}$
                        {row.amount.toLocaleString("es-CL")}
                      </TableCell>
                      <TableCell className="text-right pr-5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => removeRow(i)}
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
    </div>
  );
}
