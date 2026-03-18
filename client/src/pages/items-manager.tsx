import { useState } from "react";
import {
  useItems,
  useCategories,
  useCreateItem,
  useUpdateItem,
  useDeleteItem,
} from "@/lib/hooks";
import type { Item } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Settings, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ItemsManagerPage() {
  const [newName, setNewName] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const { toast } = useToast();

  const { data: items = [] } = useItems();
  const { data: categories = [] } = useCategories();
  const createMutation = useCreateItem();
  const updateMutation = useUpdateItem();
  const deleteMutation = useDeleteItem();

  // Build a lookup: categoryId → category
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c]));

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createMutation.mutate(
      { name: newName.trim(), categoryId: newCategoryId || null },
      {
        onSuccess: () => {
          setNewName("");
          setNewCategoryId("");
          toast({ title: "Item creado" });
        },
      }
    );
  };

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditCategoryId(item.categoryId || "");
  };

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    updateMutation.mutate(
      { id: editingId, data: { name: editName.trim(), categoryId: editCategoryId || null } },
      {
        onSuccess: () => {
          setEditingId(null);
          toast({ title: "Item actualizado" });
        },
      }
    );
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <Settings className="size-5 text-primary" />
        <h2 className="text-xl font-semibold">Items Guardados</h2>
      </div>

      <p className="text-sm text-muted-foreground max-w-xl">
        Los items son subcategorías asociadas a una categoría agrupadora.
        Puedes crearlos y editarlos aquí. Al agregar una transacción,
        seleccionas primero la categoría y luego la subcategoría.
      </p>

      {/* Add Item Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Plus className="size-4" />
            Nuevo Item
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex items-center gap-3 flex-wrap">
            <Input
              placeholder="Nombre de la subcategoría"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-64"
              data-testid="input-new-item"
            />
            <Select value={newCategoryId} onValueChange={setNewCategoryId}>
              <SelectTrigger className="w-48" data-testid="select-item-category">
                <SelectValue placeholder="Categoría agrupadora" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-create-item">
              Crear
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Items Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Todos los Items ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table className="zebra-stripe" data-testid="table-items">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Subcategoría</TableHead>
                <TableHead>Categoría Agrupadora</TableHead>
                <TableHead className="text-right pr-5">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="pl-5">
                    {editingId === item.id ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 w-64"
                        autoFocus
                      />
                    ) : (
                      <span className="text-sm font-medium">{item.name}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingId === item.id ? (
                      <Select value={editCategoryId} onValueChange={setEditCategoryId}>
                        <SelectTrigger className="w-48 h-8 text-xs">
                          <SelectValue placeholder="Sin categoría" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.id}>
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        {item.categoryId ? (categoryMap[item.categoryId]?.name ?? "ID inválido") : "Sin asignar"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right pr-5">
                    {editingId === item.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={saveEdit}
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
                          onClick={() => startEdit(item)}
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() =>
                            deleteMutation.mutate(item.id, {
                              onSuccess: () => toast({ title: "Item eliminado" }),
                            })
                          }
                        >
                          <Trash2 className="size-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                    No hay items guardados
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
