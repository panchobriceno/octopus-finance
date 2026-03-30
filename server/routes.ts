import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertTransactionSchema, insertCategorySchema, insertItemSchema, insertBudgetSchema } from "@shared/schema";

const PDF_EXTRACTION_PROMPT = `Eres un extractor de datos financieros. Se te entrega un estado de cuenta bancario chileno en PDF.
Extrae TODOS los movimientos del período actual y devuelve ÚNICAMENTE un JSON válido con este formato exacto, sin texto adicional, sin markdown, sin explicaciones:
{
  "payUntil": "YYYY-MM-DD",
  "movements": [
    {
      "date": "YYYY-MM-DD",
      "description": "descripción del movimiento",
      "amount": 12990,
      "installments": "01/01"
    }
  ]
}
Los montos deben ser números positivos para compras y negativos para pagos a la tarjeta.
Incluir TODOS los movimientos: compras, pagos, cargos, comisiones, cuotas de períodos anteriores.`;

type ClaudePdfMovement = {
  date: string;
  description: string;
  amount: number;
  installments: string;
};

type ClaudePdfExtraction = {
  payUntil: string;
  movements: ClaudePdfMovement[];
};

function parseClaudePdfExtraction(rawText: string): ClaudePdfExtraction {
  const normalized = rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parsed = JSON.parse(normalized) as Partial<ClaudePdfExtraction>;
  if (!Array.isArray(parsed.movements)) {
    throw new Error("Claude no devolvió una lista válida de movimientos.");
  }

  return {
    payUntil: typeof parsed.payUntil === "string" ? parsed.payUntil : "",
    movements: parsed.movements.map((movement) => ({
      date: typeof movement?.date === "string" ? movement.date : "",
      description: typeof movement?.description === "string" ? movement.description : "",
      amount: typeof movement?.amount === "number" ? movement.amount : Number(movement?.amount ?? NaN),
      installments: typeof movement?.installments === "string" ? movement.installments : "",
    })),
  };
}

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

  app.post("/api/extract-pdf", async (req, res) => {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY no está configurada en el servidor." });
    }

    const pdfBase64 = typeof req.body?.pdfBase64 === "string" ? req.body.pdfBase64.trim() : "";
    if (!pdfBase64) {
      return res.status(400).json({ error: "Expected pdfBase64 string" });
    }

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 12000,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: pdfBase64,
                  },
                },
                {
                  type: "text",
                  text: PDF_EXTRACTION_PROMPT,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(502).json({ error: errorText || "Claude no pudo procesar el PDF." });
      }

      const payload = await response.json() as {
        content?: Array<{ type: string; text?: string }>;
      };
      const responseText = payload.content
        ?.filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim();

      if (!responseText) {
        return res.status(502).json({ error: "Claude no devolvió contenido legible para el PDF." });
      }

      return res.json(parseClaudePdfExtraction(responseText));
    } catch (error) {
      console.error("PDF extraction failed:", error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : "No se pudo extraer información del PDF.",
      });
    }
  });

  return httpServer;
}
