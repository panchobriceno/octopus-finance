import { useState } from "react";
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "@/lib/hooks";
import type { Category } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tags, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FAMILY_SUGGESTED_CATEGORIES = [
  { name: "Otros", color: "#64748b" },
  { name: "Intereses bancarios", color: "#b45309" },
  { name: "Comisiones bancarias", color: "#92400e" },
  { name: "Viajes", color: "#0f766e" },
  { name: "Transporte", color: "#1d4ed8" },
  { name: "Pago tarjeta", color: "#7c3aed" },
];

export default function CategoriesPage() {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"income" | "expense">("expense");
  const [newColor, setNewColor] = useState("#10b981");
  const [newWorkspace, setNewWorkspace] = useState<"business" | "family" | "dentist">("business");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editWorkspace, setEditWorkspace] = useState<"business" | "family" | "dentist">("business");
  const { toast } = useToast();

  const { data: categories = [], isLoading } = useCategories();
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createMutation.mutate(
      {
        name: newName.trim(),
        type: newType,
        color: newColor,
        workspace: newType === "expense" ? newWorkspace : "business",
      },
      {
        onSuccess: () => {
          setNewName("");
          toast({ title: "Categoría creada" });
        },
      }
    );
  };

  const handleInstallFamilySuggestions = async () => {
    const existing = new Set(
      categories
        .filter((category) => category.type === "expense" && (category.workspace ?? "business") === "family")
        .map((category) => category.name.toLowerCase()),
    );

    const missing = FAMILY_SUGGESTED_CATEGORIES.filter((category) => !existing.has(category.name.toLowerCase()));

    if (missing.length === 0) {
      toast({ title: "Categorías sugeridas ya existen" });
      return;
    }

    for (const category of missing) {
      await createMutation.mutateAsync({
        name: category.name,
        type: "expense",
        color: category.color,
        workspace: "family",
      });
    }

    toast({ title: "Categorías familiares sugeridas creadas" });
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditColor(cat.color || "#64748b");
    setEditWorkspace((cat.workspace as "business" | "family" | "dentist" | null) ?? "business");
  };

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    updateMutation.mutate(
      { id: editingId, data: { name: editName.trim(), color: editColor, workspace: editWorkspace } },
      {
        onSuccess: () => {
          setEditingId(null);
          toast({ title: "Categoría actualizada" });
        },
      }
    );
  };

  const incomeCategories = categories.filter((c) => c.type === "income");
  const expenseCategories = categories.filter((c) => c.type === "expense");

  const renderTable = (cats: Category[], label: string) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table className="zebra-stripe">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Color</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Ámbito</TableHead>
              <TableHead className="text-right pr-5">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cats.map((cat) => (
              <TableRow key={cat.id}>
                <TableCell className="pl-5">
                  {editingId === cat.id ? (
                    <Input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="w-10 h-8 p-0.5 cursor-pointer"
                    />
                  ) : (
                    <div
                      className="size-6 rounded-md"
                      style={{ backgroundColor: cat.color || "#64748b" }}
                    />
                  )}
                </TableCell>
                <TableCell>
                  {editingId === cat.id ? (
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 w-48"
                      autoFocus
                    />
                  ) : (
                    <span className="text-sm font-medium">{cat.name}</span>
                  )}
                </TableCell>
                <TableCell>
                  {cat.type === "expense" ? (
                    editingId === cat.id ? (
                      <Select value={editWorkspace} onValueChange={(v) => setEditWorkspace(v as "business" | "family" | "dentist")}>
                        <SelectTrigger className="h-8 w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="business">Empresa</SelectItem>
                          <SelectItem value="family">Familia</SelectItem>
                          <SelectItem value="dentist">Consulta Dentista</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        {(cat.workspace ?? "business") === "family"
                          ? "Familia"
                          : (cat.workspace ?? "business") === "dentist"
                          ? "Consulta Dentista"
                          : "Empresa"}
                      </Badge>
                    )
                  ) : (
                    <Badge variant="secondary" className="text-xs">Ingreso</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right pr-5">
                  {editingId === cat.id ? (
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={saveEdit}
                        data-testid={`button-save-${cat.id}`}
                      >
                        <Check className="size-3.5 text-emerald-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="size-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => startEdit(cat)}
                        data-testid={`button-edit-${cat.id}`}
                      >
                        <Pencil className="size-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() =>
                          deleteMutation.mutate(cat.id, {
                            onSuccess: () => toast({ title: "Categoría eliminada" }),
                          })
                        }
                        data-testid={`button-delete-${cat.id}`}
                      >
                        <Trash2 className="size-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {cats.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                  No hay categorías
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <Tags className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Categorías</h2>
      </div>

      {/* Add Category Form */}
      <Card>
        <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Plus className="size-4" />
          Nueva Categoría
        </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="text-sm text-muted-foreground">
              Puedes crear categorías manuales o cargar una base sugerida para familia.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={handleInstallFamilySuggestions}
              disabled={createMutation.isPending}
            >
              Instalar sugeridas familia
            </Button>
          </div>
          <form onSubmit={handleCreate} className="flex items-center gap-3 flex-wrap">
            <Input
              placeholder="Nombre"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-48"
              data-testid="input-new-category"
            />
            <Select value={newType} onValueChange={(v) => setNewType(v as "income" | "expense")}>
              <SelectTrigger className="w-32" data-testid="select-category-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Ingreso</SelectItem>
                <SelectItem value="expense">Gasto</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-12 h-9 p-0.5 cursor-pointer"
              data-testid="input-category-color"
            />
            <Select value={newWorkspace} onValueChange={(v) => setNewWorkspace(v as "business" | "family" | "dentist")} disabled={newType === "income"}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="business">Empresa</SelectItem>
                <SelectItem value="family">Familia</SelectItem>
                <SelectItem value="dentist">Consulta Dentista</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-create-category">
              Crear
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {renderTable(incomeCategories, "Categorías de Ingresos")}
        {renderTable(expenseCategories, "Categorías de Gastos")}
      </div>
    </div>
  );
}
