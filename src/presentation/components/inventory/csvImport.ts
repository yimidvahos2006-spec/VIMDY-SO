import { Category, Product } from "../../../core/entities/Entities";
import { ProductInput } from "../../../core/engines/InventoryEngine";
import { ProductType, resolveProductFlags } from "../../../core/types/productType";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";
import { inferUnitFromProductName } from "./importHelpers";

/**
 * Importación de productos e insumos desde CSV (sin IA, sin dependencias).
 * Todo lo de aquí es lógica pura: no toca la base de datos ni la pantalla.
 */

export type ImportableType = Extract<ProductType, "inventario" | "ingrediente" | "cocina" | "servicio">;
export type DuplicateMode = "skip" | "update";

export const MAX_IMPORT_ROWS = 2000;
export const INSUMOS_CATEGORY_NAME = "Insumos";

/* ----------------------------- Texto y nombres ---------------------------- */

/** Compara sin importar mayúsculas, tildes ni espacios de más ("Café" = " cafe "). */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function headerKey(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

/* ------------------------------- Lector CSV ------------------------------- */

function detectDelimiter(text: string): string {
  // Se cuenta en la primera línea (encabezado), ignorando lo que va entre comillas.
  let inQuotes = false;
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  if (counts[";"] >= counts[","] && counts[";"] >= counts["\t"] && counts[";"] > 0) return ";";
  if (counts["\t"] > counts[","]) return "\t";
  return ",";
}

/**
 * Lee un CSV de Excel: acepta UTF-8 con o sin BOM, separador `;` `,` o tab,
 * comillas con "" escapadas, saltos de línea de Windows o Linux. Ignora filas vacías.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delimiter) endField();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
    } else if (ch === "\n") endRow();
    else field += ch;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/* -------------------------------- Plantilla ------------------------------- */

export const TEMPLATE_HEADERS = [
  "Nombre",
  "Tipo",
  "Categoría",
  "Unidad",
  "Costo",
  "Precio de venta",
  "Stock inicial",
  "Código de barras"
] as const;

const TEMPLATE_EXAMPLES: string[][] = [
  ["Agua 600 ml", "Producto", "Bebidas", "unidad", "1200", "3500", "24", ""],
  ["Hamburguesa", "Cocina", "Platos fuertes", "unidad", "", "18000", "", ""],
  ["Carne molida", "Insumo", "Insumos", "kg", "22000", "", "5,5", ""]
];

/** CSV de ejemplo en español: `;` como separador y BOM para que Excel respete las tildes. */
export function buildTemplateCsv(): string {
  const lines = [TEMPLATE_HEADERS as readonly string[], ...TEMPLATE_EXAMPLES].map((cells) =>
    cells.map((cell) => (/[;"\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(";")
  );
  return `﻿${lines.join("\r\n")}\r\n`;
}

/* ------------------------------ Columnas y tipo --------------------------- */

type Field = "name" | "type" | "category" | "unit" | "cost" | "price" | "stock" | "minStock" | "barcode";

const COLUMN_ALIASES: Record<Field, string[]> = {
  name: ["nombre", "producto", "nombredelproducto", "articulo", "item"],
  type: ["tipo", "tipodeproducto", "clase"],
  category: ["categoria", "grupo", "familia"],
  unit: ["unidad", "unidaddemedida", "um"],
  cost: ["costo", "costodecompra", "preciodecompra", "costounitario"],
  price: ["preciodeventa", "precio", "pvp", "preciopublico", "valorventa"],
  stock: ["stockinicial", "stock", "stockactual", "existencias", "cantidad", "inventarioinicial"],
  minStock: ["stockminimo", "minimo", "stockmin", "minimodestock"],
  barcode: ["codigodebarras", "codigobarras", "barras", "ean", "codigo", "barcode"]
};

export type ColumnMap = Partial<Record<Field, number>>;

export function detectColumns(headerRow: string[]): ColumnMap {
  const map: ColumnMap = {};
  headerRow.forEach((cell, index) => {
    const key = headerKey(cell);
    if (!key) return;
    (Object.keys(COLUMN_ALIASES) as Field[]).forEach((field) => {
      if (map[field] === undefined && COLUMN_ALIASES[field].includes(key)) map[field] = index;
    });
  });
  return map;
}

const TYPE_ALIASES: Array<[ImportableType, string[]]> = [
  ["inventario", ["producto", "inventario", "productodeinventario", "mercancia", "bebida", "snack"]],
  ["ingrediente", ["insumo", "insumos", "ingrediente", "ingredientes", "materiaprima"]],
  ["cocina", ["cocina", "plato", "platoalacarta", "preparado", "comida"]],
  ["servicio", ["servicio", "servicios"]]
];

function resolveType(raw: string): ImportableType | "receta" | null {
  const key = headerKey(raw);
  if (!key) return "inventario";
  if (key === "receta" || key === "cocinaconreceta" || key === "platoconreceta") return "receta";
  for (const [type, aliases] of TYPE_ALIASES) {
    if (aliases.includes(key)) return type;
  }
  return null;
}

const UNIT_ALIASES: Record<string, string> = {
  und: "unidad", unidad: "unidad", unidades: "unidad", u: "unidad", un: "unidad",
  kg: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  g: "g", gr: "g", gramo: "g", gramos: "g",
  l: "litro", lt: "litro", lts: "litro", litro: "litro", litros: "litro",
  ml: "ml", mililitro: "ml", mililitros: "ml",
  lb: "libra", lbs: "libra", libra: "libra", libras: "libra",
  servicio: "servicio"
};

function resolveUnit(raw: string, name: string): string {
  const key = normalizeText(raw);
  if (!key) return inferUnitFromProductName(name);
  return UNIT_ALIASES[key] ?? raw.trim();
}

/* ----------------------------- Filas validadas ---------------------------- */

export interface ImportRow {
  /** Número de fila tal como la ve la persona en Excel (la 1 es el encabezado). */
  line: number;
  name: string;
  type: ImportableType;
  categoryName: string;
  unit: string;
  cost?: number;
  price: number;
  stock: number;
  minStock?: number;
  barcode?: string;
  errors: string[];
  warnings: string[];
}

export interface ParsedCsv {
  /** Error que impide seguir (ej. falta la columna Nombre). */
  fatalError?: string;
  rows: ImportRow[];
  /** Columnas del archivo que no se reconocieron (se ignoran). */
  ignoredColumns: string[];
}

const SCIENTIFIC = /^\d+([.,]\d+)?e[+-]?\d+$/i;

function cell(row: string[], index: number | undefined): string {
  return index === undefined ? "" : (row[index] ?? "").trim();
}

function parseNumberCell(raw: string, label: string, errors: string[]): number | undefined {
  if (!raw) return undefined;
  const value = parseMoneyInput(raw);
  if (!Number.isFinite(value)) {
    errors.push(`${label} no es un número válido ("${raw}").`);
    return undefined;
  }
  if (value < 0) {
    errors.push(`${label} no puede ser negativo.`);
    return undefined;
  }
  return value;
}

export function parseImportCsv(text: string): ParsedCsv {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { fatalError: "El archivo está vacío.", rows: [], ignoredColumns: [] };
  }

  const [header, ...body] = table;
  const columns = detectColumns(header);
  if (columns.name === undefined) {
    return {
      fatalError: 'No encontré la columna "Nombre". Descarga la plantilla y usa sus encabezados.',
      rows: [],
      ignoredColumns: []
    };
  }
  if (body.length === 0) {
    return { fatalError: "El archivo solo tiene encabezados, sin productos.", rows: [], ignoredColumns: [] };
  }
  if (body.length > MAX_IMPORT_ROWS) {
    return {
      fatalError: `El archivo tiene ${body.length} filas; el máximo por importación es ${MAX_IMPORT_ROWS}. Divídelo en partes.`,
      rows: [],
      ignoredColumns: []
    };
  }

  const used = new Set(Object.values(columns));
  const ignoredColumns = header.map((h, i) => ({ h: h.trim(), i })).filter(({ h, i }) => h && !used.has(i)).map(({ h }) => h);

  const rows: ImportRow[] = body.map((raw, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = cell(raw, columns.name).replace(/\s+/g, " ");

    const typeRaw = cell(raw, columns.type);
    const resolved = resolveType(typeRaw);
    let type: ImportableType = "inventario";
    if (resolved === "receta") {
      errors.push("Los productos con receta se crean en el formulario; aquí importa sus insumos y productos simples.");
    } else if (resolved === null) {
      errors.push(`Tipo "${typeRaw}" no reconocido. Usa Producto, Cocina, Insumo o Servicio.`);
    } else {
      type = resolved;
    }

    if (!name) errors.push("Falta el nombre.");

    const price = parseNumberCell(cell(raw, columns.price), "El precio de venta", errors);
    const cost = parseNumberCell(cell(raw, columns.cost), "El costo", errors);
    const stockParsed = parseNumberCell(cell(raw, columns.stock), "El stock inicial", errors);
    const minStockParsed = parseNumberCell(cell(raw, columns.minStock), "El stock mínimo", errors);

    if (type !== "ingrediente" && price === undefined && !errors.some((e) => e.startsWith("El precio"))) {
      errors.push("Falta el precio de venta.");
    }

    let stock = stockParsed ?? 0;
    if (stock > 0 && (type === "cocina" || type === "servicio")) {
      warnings.push("Este tipo no maneja stock: el stock inicial se ignora.");
      stock = 0;
    }

    const barcodeRaw = cell(raw, columns.barcode);
    let barcode: string | undefined;
    if (barcodeRaw) {
      if (SCIENTIFIC.test(barcodeRaw)) {
        errors.push("El código de barras quedó en notación científica (Excel lo recortó). Formatea la columna como Texto.");
      } else {
        barcode = barcodeRaw;
      }
    }

    return {
      line: index + 2,
      name,
      type,
      categoryName: cell(raw, columns.category).replace(/\s+/g, " "),
      unit: resolveUnit(cell(raw, columns.unit), name),
      cost,
      price: type === "ingrediente" ? 0 : (price ?? 0),
      stock,
      minStock: minStockParsed,
      barcode,
      errors,
      warnings
    };
  });

  return { rows, ignoredColumns };
}

/* ------------------------------ Plan de importación ----------------------- */

export type RowAction = "create" | "update" | "skip" | "error";

export interface PlannedRow {
  row: ImportRow;
  action: RowAction;
  /** Si es duplicado: el producto que ya existe. */
  existing?: Product;
  /** Motivos (errores propios + los del plan: repetido en archivo, categoría, etc.). */
  errors: string[];
}

export interface MissingCategory {
  name: string;
  insumo: boolean;
}

export interface ImportPlan {
  planned: PlannedRow[];
  missingCategories: MissingCategory[];
  counts: { create: number; update: number; skip: number; error: number };
}

function categoryKey(name: string, insumo: boolean): string {
  return `${insumo ? "i" : "p"}:${normalizeText(name)}`;
}

export function buildImportPlan(
  rows: ImportRow[],
  existingProducts: Product[],
  existingCategories: Category[],
  duplicateMode: DuplicateMode
): ImportPlan {
  const byName = new Map<string, Product>();
  const barcodes = new Map<string, Product>();
  for (const p of existingProducts) {
    if (p.active === false) continue;
    byName.set(`${p.isIngredient === true ? "i" : "p"}:${normalizeText(p.name)}`, p);
    if (p.barcode) barcodes.set(normalizeText(p.barcode), p);
  }

  const catByKey = new Map<string, Category>();
  const catByNameAnyKind = new Map<string, Category>();
  for (const c of existingCategories) {
    catByKey.set(categoryKey(c.name, c.kind === "INSUMO"), c);
    catByNameAnyKind.set(normalizeText(c.name), c);
  }

  const seenInFile = new Map<string, number>();
  const barcodesInFile = new Map<string, number>();
  const missing = new Map<string, MissingCategory>();
  const counts = { create: 0, update: 0, skip: 0, error: 0 };

  const planned: PlannedRow[] = rows.map((row) => {
    const errors = [...row.errors];
    const insumo = row.type === "ingrediente";

    if (row.name) {
      const key = `${insumo ? "i" : "p"}:${normalizeText(row.name)}`;
      const firstLine = seenInFile.get(key);
      if (firstLine !== undefined) errors.push(`Repetido en el archivo (ya aparece en la fila ${firstLine}).`);
      else seenInFile.set(key, row.line);
    }

    if (row.barcode) {
      const key = normalizeText(row.barcode);
      const firstLine = barcodesInFile.get(key);
      if (firstLine !== undefined) errors.push(`El código de barras ya aparece en la fila ${firstLine}.`);
      else barcodesInFile.set(key, row.line);
    }

    const categoryName = row.categoryName || (insumo ? INSUMOS_CATEGORY_NAME : "");
    if (!categoryName && row.name) errors.push("Falta la categoría.");

    let needsCategory: MissingCategory | undefined;
    if (categoryName) {
      if (!catByKey.has(categoryKey(categoryName, insumo))) {
        const other = catByNameAnyKind.get(normalizeText(categoryName));
        if (other) {
          errors.push(
            insumo
              ? `"${categoryName}" es una categoría de productos de venta; usa otra para los insumos.`
              : `"${categoryName}" es una categoría de insumos; usa otra para productos de venta.`
          );
        } else {
          needsCategory = { name: categoryName, insumo };
        }
      }
    }

    const existing = row.name ? byName.get(`${insumo ? "i" : "p"}:${normalizeText(row.name)}`) : undefined;

    if (row.barcode && errors.length === row.errors.length) {
      const owner = barcodes.get(normalizeText(row.barcode));
      if (owner && owner.id !== existing?.id) {
        errors.push(`El código de barras ya lo usa "${owner.name}".`);
      }
    }

    let action: RowAction;
    if (errors.length > 0) action = "error";
    else if (existing) action = duplicateMode === "update" ? "update" : "skip";
    else action = "create";

    if (action === "create" || action === "update") {
      if (needsCategory) {
        const key = categoryKey(needsCategory.name, needsCategory.insumo);
        if (!missing.has(key)) missing.set(key, needsCategory);
      }
    }

    counts[action] += 1;
    return { row, action, existing, errors };
  });

  return { planned, missingCategories: [...missing.values()], counts };
}

/* --------------------------- De fila a producto --------------------------- */

export function rowToProductInput(row: ImportRow, categoryId: string): ProductInput {
  const flags = resolveProductFlags(row.type, "ON_DEMAND");
  const showsStock = row.type === "inventario" || row.type === "ingrediente";
  return {
    name: row.name,
    categoryId,
    price: row.price,
    purchasePrice: row.cost,
    stock: showsStock ? row.stock : 0,
    minStock: showsStock ? (row.minStock ?? 0) : 0,
    unit: row.unit,
    barcode: row.barcode,
    active: true,
    trackStock: flags.trackStock,
    requiresKitchen: flags.requiresKitchen,
    isIngredient: row.type === "ingrediente"
  };
}

/** Qué se cambia al actualizar un duplicado: solo lo que el archivo trae. Nunca stock. */
export function rowToUpdatePatch(row: ImportRow, existing: Product, categoryId: string): ProductInput {
  return {
    name: existing.name,
    categoryId,
    ...(row.type !== "ingrediente" ? { price: row.price } : {}),
    ...(row.cost !== undefined ? { purchasePrice: row.cost } : {}),
    ...(row.barcode !== undefined ? { barcode: row.barcode } : {})
  };
}