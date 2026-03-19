import {
  type Transaction,
  type InsertTransaction,
  type Category,
  type InsertCategory,
  type Item,
  type InsertItem,
  type Budget,
  type InsertBudget,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Transactions
  getTransactions(): Promise<Transaction[]>;
  getTransaction(id: string): Promise<Transaction | undefined>;
  createTransaction(tx: InsertTransaction): Promise<Transaction>;
  updateTransaction(id: string, tx: Partial<InsertTransaction>): Promise<Transaction | undefined>;
  deleteTransaction(id: string): Promise<boolean>;
  deleteTransactions(ids: string[]): Promise<number>;

  // Categories
  getCategories(): Promise<Category[]>;
  getCategory(id: string): Promise<Category | undefined>;
  createCategory(cat: InsertCategory): Promise<Category>;
  updateCategory(id: string, cat: Partial<InsertCategory>): Promise<Category | undefined>;
  deleteCategory(id: string): Promise<boolean>;

  // Items
  getItems(): Promise<Item[]>;
  getItem(id: string): Promise<Item | undefined>;
  createItem(item: InsertItem): Promise<Item>;
  updateItem(id: string, item: Partial<InsertItem>): Promise<Item | undefined>;
  deleteItem(id: string): Promise<boolean>;

  // Budgets
  getBudgets(): Promise<Budget[]>;
  getBudget(id: string): Promise<Budget | undefined>;
  createBudget(b: InsertBudget): Promise<Budget>;
  updateBudget(id: string, b: Partial<InsertBudget>): Promise<Budget | undefined>;
  deleteBudget(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private transactions: Map<string, Transaction>;
  private categories: Map<string, Category>;
  private items: Map<string, Item>;
  private budgets: Map<string, Budget>;

  constructor() {
    this.transactions = new Map();
    this.categories = new Map();
    this.items = new Map();
    this.budgets = new Map();
    this.seedData();
  }

  /** Helper: find a category by name and return its id */
  private getCategoryIdByName(name: string): string | null {
    for (const cat of Array.from(this.categories.values())) {
      if (cat.name === name) return cat.id;
    }
    return null;
  }

  private seedData() {
    // Seed categories
    const defaultCategories: InsertCategory[] = [
      { name: "Ventas", type: "income", color: "#10b981" },
      { name: "Servicios", type: "income", color: "#3b82f6" },
      { name: "Consultoría", type: "income", color: "#8b5cf6" },
      { name: "Otros Ingresos", type: "income", color: "#06b6d4" },
      { name: "Arriendo", type: "expense", color: "#ef4444" },
      { name: "Sueldos", type: "expense", color: "#f97316" },
      { name: "Software/Herramientas", type: "expense", color: "#eab308" },
      { name: "Marketing", type: "expense", color: "#ec4899" },
      { name: "Oficina", type: "expense", color: "#64748b" },
      { name: "Impuestos", type: "expense", color: "#dc2626" },
      { name: "Servicios Básicos", type: "expense", color: "#a855f7" },
      { name: "Transporte", type: "expense", color: "#14b8a6" },
    ];

    for (const cat of defaultCategories) {
      const id = randomUUID();
      this.categories.set(id, { ...cat, id, color: cat.color ?? null, workspace: cat.workspace ?? null });
    }

    // Seed items — now use categoryId (resolved from category name)
    const itemDefs: { name: string; categoryName: string }[] = [
      { name: "Meta Ads - Cliente X", categoryName: "Marketing" },
      { name: "Google Ads - Cliente Y", categoryName: "Marketing" },
      { name: "Diseño Gráfico", categoryName: "Servicios" },
      { name: "Gestión RRSS", categoryName: "Servicios" },
      { name: "Producción Audiovisual", categoryName: "Servicios" },
      { name: "Consultoría Digital", categoryName: "Consultoría" },
      { name: "Adobe Creative Suite", categoryName: "Software/Herramientas" },
      { name: "Semrush", categoryName: "Software/Herramientas" },
      { name: "Figma", categoryName: "Software/Herramientas" },
      { name: "Arriendo Oficina", categoryName: "Arriendo" },
    ];

    for (const def of itemDefs) {
      const id = randomUUID();
      const categoryId = this.getCategoryIdByName(def.categoryName);
      this.items.set(id, { id, name: def.name, categoryId });
    }

    // Seed transactions
    const sampleTransactions: InsertTransaction[] = [
      // Enero 2026
      { name: "Gestión RRSS - Clínica Dental", category: "Servicios", amount: 450000, type: "income", date: "2026-01-05", notes: null },
      { name: "Meta Ads - Restaurant Sushi", category: "Ventas", amount: 380000, type: "income", date: "2026-01-10", notes: null },
      { name: "Diseño Logo - Inmobiliaria", category: "Servicios", amount: 250000, type: "income", date: "2026-01-15", notes: null },
      { name: "Consultoría Marketing Digital", category: "Consultoría", amount: 600000, type: "income", date: "2026-01-20", notes: null },
      { name: "Arriendo Oficina", category: "Arriendo", amount: 350000, type: "expense", date: "2026-01-01", notes: null },
      { name: "Sueldo Silvi", category: "Sueldos", amount: 550000, type: "expense", date: "2026-01-05", notes: null },
      { name: "Sueldo Benja", category: "Sueldos", amount: 550000, type: "expense", date: "2026-01-05", notes: null },
      { name: "Adobe Creative Suite", category: "Software/Herramientas", amount: 45000, type: "expense", date: "2026-01-08", notes: null },
      { name: "Semrush", category: "Software/Herramientas", amount: 65000, type: "expense", date: "2026-01-08", notes: null },
      { name: "Luz + Internet", category: "Servicios Básicos", amount: 48000, type: "expense", date: "2026-01-10", notes: null },

      // Febrero 2026
      { name: "Gestión RRSS - Clínica Dental", category: "Servicios", amount: 450000, type: "income", date: "2026-02-05", notes: null },
      { name: "Google Ads - Dentista", category: "Ventas", amount: 320000, type: "income", date: "2026-02-08", notes: null },
      { name: "Producción Video Corporativo", category: "Servicios", amount: 800000, type: "income", date: "2026-02-12", notes: null },
      { name: "Landing Page - Startup Tech", category: "Servicios", amount: 350000, type: "income", date: "2026-02-18", notes: null },
      { name: "Arriendo Oficina", category: "Arriendo", amount: 350000, type: "expense", date: "2026-02-01", notes: null },
      { name: "Sueldo Silvi", category: "Sueldos", amount: 550000, type: "expense", date: "2026-02-05", notes: null },
      { name: "Sueldo Benja", category: "Sueldos", amount: 550000, type: "expense", date: "2026-02-05", notes: null },
      { name: "Adobe Creative Suite", category: "Software/Herramientas", amount: 45000, type: "expense", date: "2026-02-08", notes: null },
      { name: "Luz + Internet", category: "Servicios Básicos", amount: 52000, type: "expense", date: "2026-02-10", notes: null },

      // Marzo 2026
      { name: "Gestión RRSS - Clínica Dental", category: "Servicios", amount: 450000, type: "income", date: "2026-03-05", notes: null },
      { name: "Meta Ads - Gym CrossFit", category: "Ventas", amount: 280000, type: "income", date: "2026-03-07", notes: null },
      { name: "Diseño Branding - Cafetería", category: "Servicios", amount: 500000, type: "income", date: "2026-03-10", notes: null },
      { name: "Consultoría SEO", category: "Consultoría", amount: 400000, type: "income", date: "2026-03-15", notes: null },
      { name: "Arriendo Oficina", category: "Arriendo", amount: 350000, type: "expense", date: "2026-03-01", notes: null },
      { name: "Sueldo Silvi", category: "Sueldos", amount: 550000, type: "expense", date: "2026-03-05", notes: null },
      { name: "Sueldo Benja", category: "Sueldos", amount: 550000, type: "expense", date: "2026-03-05", notes: null },
      { name: "Figma Pro", category: "Software/Herramientas", amount: 25000, type: "expense", date: "2026-03-08", notes: null },
      { name: "Semrush", category: "Software/Herramientas", amount: 65000, type: "expense", date: "2026-03-08", notes: null },
      { name: "Luz + Internet", category: "Servicios Básicos", amount: 50000, type: "expense", date: "2026-03-10", notes: null },
    ];

    for (const tx of sampleTransactions) {
      const id = randomUUID();
      this.transactions.set(id, {
        ...tx,
        id,
        notes: tx.notes ?? null,
        subtype: "actual",
        status: "paid",
        itemId: null,
      });
    }

    // Seed budgets (Marzo 2026 to match seed transactions)
    const sampleBudgets: InsertBudget[] = [
      { year: 2026, month: 3, categoryGroup: "Gastos Básicos", amount: 120000 },
      { year: 2026, month: 3, categoryGroup: "Auto", amount: 180000 },
      { year: 2026, month: 3, categoryGroup: "Consulta Javi", amount: 95000 },
      { year: 2026, month: 3, categoryGroup: "Seguros complementarios", amount: 150000 },
      { year: 2026, month: 3, categoryGroup: "Digital", amount: 45000 },
    ];

    for (const b of sampleBudgets) {
      const id = randomUUID();
      this.budgets.set(id, { ...b, id });
    }
  }

  // Transactions
  async getTransactions(): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  async getTransaction(id: string): Promise<Transaction | undefined> {
    return this.transactions.get(id);
  }

  async createTransaction(tx: InsertTransaction): Promise<Transaction> {
    const id = randomUUID();

    // If itemId is provided, resolve category from the item's parent category
    let resolvedCategory = tx.category;
    if (tx.itemId) {
      const item = this.items.get(tx.itemId);
      if (item?.categoryId) {
        const cat = this.categories.get(item.categoryId);
        if (cat) {
          resolvedCategory = cat.name;
        }
      }
    }

    const transaction: Transaction = {
      ...tx,
      id,
      category: resolvedCategory,
      notes: tx.notes ?? null,
      subtype: tx.subtype ?? "actual",
      status: tx.status ?? "paid",
      itemId: tx.itemId ?? null,
    };
    this.transactions.set(id, transaction);

    return transaction;
  }

  async updateTransaction(id: string, tx: Partial<InsertTransaction>): Promise<Transaction | undefined> {
    const existing = this.transactions.get(id);
    if (!existing) return undefined;

    // If itemId changed, resolve category from item's parent category
    if (tx.itemId !== undefined && tx.itemId) {
      const item = this.items.get(tx.itemId);
      if (item?.categoryId) {
        const cat = this.categories.get(item.categoryId);
        if (cat) {
          tx.category = cat.name;
        }
      }
    }

    const updated = { ...existing, ...tx };
    this.transactions.set(id, updated);
    return updated;
  }

  async deleteTransaction(id: string): Promise<boolean> {
    return this.transactions.delete(id);
  }

  async deleteTransactions(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of ids) {
      if (this.transactions.delete(id)) count++;
    }
    return count;
  }

  // Categories
  async getCategories(): Promise<Category[]> {
    return Array.from(this.categories.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getCategory(id: string): Promise<Category | undefined> {
    return this.categories.get(id);
  }

  async createCategory(cat: InsertCategory): Promise<Category> {
    const id = randomUUID();
    const category: Category = { ...cat, id, color: cat.color ?? null, workspace: cat.workspace ?? null };
    this.categories.set(id, category);
    return category;
  }

  async updateCategory(id: string, cat: Partial<InsertCategory>): Promise<Category | undefined> {
    const existing = this.categories.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...cat, workspace: cat.workspace ?? existing.workspace ?? null };
    this.categories.set(id, updated);
    return updated;
  }

  async deleteCategory(id: string): Promise<boolean> {
    return this.categories.delete(id);
  }

  // Items
  async getItems(): Promise<Item[]> {
    return Array.from(this.items.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getItem(id: string): Promise<Item | undefined> {
    return this.items.get(id);
  }

  async createItem(item: InsertItem): Promise<Item> {
    const id = randomUUID();
    const newItem: Item = { ...item, id, categoryId: item.categoryId ?? null };
    this.items.set(id, newItem);
    return newItem;
  }

  async updateItem(id: string, item: Partial<InsertItem>): Promise<Item | undefined> {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...item };
    this.items.set(id, updated);
    return updated;
  }

  async deleteItem(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  // Budgets
  async getBudgets(): Promise<Budget[]> {
    return Array.from(this.budgets.values());
  }

  async getBudget(id: string): Promise<Budget | undefined> {
    return this.budgets.get(id);
  }

  async createBudget(b: InsertBudget): Promise<Budget> {
    const id = randomUUID();
    const budget: Budget = { ...b, id };
    this.budgets.set(id, budget);
    return budget;
  }

  async updateBudget(id: string, b: Partial<InsertBudget>): Promise<Budget | undefined> {
    const existing = this.budgets.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...b };
    this.budgets.set(id, updated);
    return updated;
  }

  async deleteBudget(id: string): Promise<boolean> {
    return this.budgets.delete(id);
  }
}

export const storage = new MemStorage();
