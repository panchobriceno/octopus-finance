import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertTransactionSchema, insertCategorySchema, insertItemSchema, insertBudgetSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // === TRANSACTIONS ===
  app.get("/api/transactions", async (_req, res) => {
    const transactions = await storage.getTransactions();
    res.json(transactions);
  });

  app.post("/api/transactions/bulk-delete", async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Expected non-empty ids array" });
    }
    const deleted = await storage.deleteTransactions(ids);
    res.json({ deleted });
  });

  app.post("/api/transactions", async (req, res) => {
    const parsed = insertTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const transaction = await storage.createTransaction(parsed.data);
    res.status(201).json(transaction);
  });

  app.patch("/api/transactions/:id", async (req, res) => {
    const { id } = req.params;
    const updated = await storage.updateTransaction(id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/transactions/:id", async (req, res) => {
    const { id } = req.params;
    const deleted = await storage.deleteTransaction(id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // === CATEGORIES ===
  app.get("/api/categories", async (_req, res) => {
    const categories = await storage.getCategories();
    res.json(categories);
  });

  app.post("/api/categories", async (req, res) => {
    const parsed = insertCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const category = await storage.createCategory(parsed.data);
    res.status(201).json(category);
  });

  app.patch("/api/categories/:id", async (req, res) => {
    const { id } = req.params;
    const updated = await storage.updateCategory(id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/categories/:id", async (req, res) => {
    const { id } = req.params;
    const deleted = await storage.deleteCategory(id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // === ITEMS ===
  app.get("/api/items", async (_req, res) => {
    const items = await storage.getItems();
    res.json(items);
  });

  app.post("/api/items", async (req, res) => {
    const parsed = insertItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const item = await storage.createItem(parsed.data);
    res.status(201).json(item);
  });

  app.patch("/api/items/:id", async (req, res) => {
    const { id } = req.params;
    const updated = await storage.updateItem(id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/items/:id", async (req, res) => {
    const { id } = req.params;
    const deleted = await storage.deleteItem(id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // === BUDGETS ===
  app.get("/api/budgets", async (_req, res) => {
    const budgets = await storage.getBudgets();
    res.json(budgets);
  });

  app.post("/api/budgets", async (req, res) => {
    const parsed = insertBudgetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const budget = await storage.createBudget(parsed.data);
    res.status(201).json(budget);
  });

  app.patch("/api/budgets/:id", async (req, res) => {
    const { id } = req.params;
    const updated = await storage.updateBudget(id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/budgets/:id", async (req, res) => {
    const { id } = req.params;
    const deleted = await storage.deleteBudget(id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // === IMPORT CSV ===
  app.post("/api/import/csv", async (req, res) => {
    const { rows } = req.body;
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: "Expected rows array" });
    }

    const imported: any[] = [];
    for (const row of rows) {
      try {
        const parsed = insertTransactionSchema.safeParse(row);
        if (parsed.success) {
          const tx = await storage.createTransaction(parsed.data);
          imported.push(tx);
        }
      } catch (e) {
        // Skip invalid rows
      }
    }

    res.json({ imported: imported.length, total: rows.length });
  });

  return httpServer;
}
