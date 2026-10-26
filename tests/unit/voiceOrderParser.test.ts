import { describe, it, expect } from "vitest";
import {
  parseVoiceOrder,
  pickBestParse,
  describeVoiceLine,
  orderNoteText,
  MAX_AUTO_QUANTITY,
  type VoiceCatalogProduct
} from "../../src/core/voice/orderParser";

const p = (id: string, name: string, extra: Partial<VoiceCatalogProduct> = {}): VoiceCatalogProduct => ({
  id,
  name,
  ...extra
});

const CATALOG: VoiceCatalogProduct[] = [
  p("aguila-light", "Cerveza Águila Light", { aliases: ["aguila light", "light"] }),
  p("aguila-original", "Cerveza Águila Original", { aliases: ["aguila original"] }),
  p("poker", "Cerveza Poker"),
  p("club", "Cerveza Club Colombia"),
  p("bandeja", "Bandeja Paisa"),
  p("hamburguesa", "Hamburguesa Clásica"),
  p("arroz-pollo", "Arroz con Pollo"),
  p("arroz", "Arroz Blanco"),
  p("coca", "Coca-Cola"),
  p("mora", "Jugo de Mora"),
  p("papas", "Papas a la Francesa"),
  p("agua", "Agua"),
  p("limonada", "Limonada Natural"),
  p("cafe", "Café"),
  p("empanada", "Empanada"),
  p("pizza", "Pizza Hawaiana"),
  p("dosequis", "Dos Equis"),
  p("viejo", "Aguardiente Antioqueño", { aliases: ["aguardiente", "guaro"] }),
  p("insumo", "Tomate", { isIngredient: true }),
  p("agotado", "Sopa del Día", { active: false })
];

const parse = (text: string, catalog = CATALOG) => parseVoiceOrder(text, catalog);

/** Resumen compacto para comparar: "2 aguila-light | 1 bandeja [sin arroz]". */
function summary(text: string, catalog = CATALOG): string {
  return parse(text, catalog)
    .lines.map(l => {
      const who =
        l.status === "matched" ? l.product!.id : l.status === "ambiguous" ? `?${l.candidates.map(c => c.id).join("/")}` : `x:${l.spoken}`;
      return `${l.quantity} ${who}${l.notes.length ? ` [${l.notes.join(", ")}]` : ""}`;
    })
    .join(" | ");
}

describe("parseVoiceOrder — el caso del pedido", () => {
  it("Mesa 3, dos cervezas águila light y una bandeja paisa sin arroz", () => {
    const result = parse("Mesa 3, dos cervezas águila light y una bandeja paisa sin arroz");
    expect(result.tableNumber).toBe(3);
    expect(result.lines).toHaveLength(2);

    expect(result.lines[0]).toMatchObject({ quantity: 2, status: "matched", notes: [] });
    expect(result.lines[0].product?.id).toBe("aguila-light");

    expect(result.lines[1]).toMatchObject({ quantity: 1, status: "matched", notes: ["sin arroz"] });
    expect(result.lines[1].product?.id).toBe("bandeja");
    expect(result.unparsed).toEqual([]);
  });

  it("funciona igual sin mesa (Caja)", () => {
    const result = parse("dos cervezas águila light y una bandeja paisa sin arroz");
    expect(result.tableNumber).toBeNull();
    expect(summary("dos cervezas águila light y una bandeja paisa sin arroz")).toBe(
      "2 aguila-light | 1 bandeja [sin arroz]"
    );
  });
});

describe("mesa", () => {
  it.each([
    ["mesa 3 dos cervezas poker", 3],
    ["mesa tres dos cervezas poker", 3],
    ["mesa veintiuna una limonada natural", 21],
    ["para la mesa 12 una limonada natural", 12],
    ["una limonada natural para la mesa 7", 7],
    ["meza 5 un café", 5]
  ])("%s → mesa %s", (text, mesa) => {
    expect(parse(text).tableNumber).toBe(mesa);
  });

  it("el número de la mesa no se confunde con la cantidad", () => {
    expect(summary("mesa tres tres empanadas")).toBe("3 empanada");
    expect(summary("mesa 3 una empanada")).toBe("1 empanada");
  });
});

describe("no confundir comandos de mesa con pedidos", () => {
  it.each([
    "mesa 3, 4 personas",
    "mesa 3 para 4",
    "mesa 12 somos 6",
    "mesa 5 con 2 comensales",
    "unir mesa 5 y 4",
    "mesa siete"
  ])("%s → sin líneas de pedido", text => {
    expect(parse(text).lines).toEqual([]);
  });

  it("mesa + comensales + pedido en la misma frase", () => {
    const result = parse("mesa 3, 4 personas, dos cervezas poker");
    expect(result.tableNumber).toBe(3);
    expect(summary("mesa 3, 4 personas, dos cervezas poker")).toBe("2 poker");
  });
});

describe("cantidades", () => {
  it.each([
    ["una cerveza poker", 1],
    ["2 cervezas poker", 2],
    ["dos cervezas poker", 2],
    ["cuatro cervezas poker", 4],
    ["doce cervezas poker", 12],
    ["veintiuna cervezas poker", 21],
    ["treinta y dos cervezas poker", 32],
    ["una docena de empanadas", 12],
    ["media docena de empanadas", 6],
    ["un par de cervezas poker", 2],
    ["otra cerveza poker", 1],
    ["cerveza poker", 1],
    ["empanadas x3", 1], // x3 va después del producto: no es cantidad del producto
    ["x3 empanadas", 3],
    ["3x empanadas", 3]
  ])("%s → %s", (text, cantidad) => {
    expect(parse(text).lines[0].quantity).toBe(cantidad);
  });

  it("cantidades absurdas piden confirmación (ruido ambiente)", () => {
    const line = parse("cincuenta cervezas poker").lines[0];
    expect(line.quantity).toBe(50);
    expect(line.needsConfirm).toBe(true);
    expect(parse(`${MAX_AUTO_QUANTITY} cervezas poker`).lines[0].needsConfirm).toBe(false);
    expect(parse(`${MAX_AUTO_QUANTITY + 1} cervezas poker`).lines[0].needsConfirm).toBe(true);
  });
});

describe("productos", () => {
  it("entiende plurales y nombres compuestos", () => {
    expect(summary("tres hamburguesas clásicas")).toBe("3 hamburguesa");
    expect(summary("cuatro coca colas")).toBe("4 coca");
    expect(summary("dos jugos de mora")).toBe("2 mora");
    expect(summary("dos papas a la francesa")).toBe("2 papas");
  });

  it("no parte nombres que contienen 'con' o 'y'", () => {
    expect(summary("un arroz con pollo")).toBe("1 arroz-pollo");
  });

  it("usa alias", () => {
    expect(summary("dos guaros")).toBe("2 viejo");
    expect(summary("una aguardiente")).toBe("1 viejo");
    expect(summary("tres light")).toBe("3 aguila-light");
  });

  it("acepta el nombre dicho a medias cuando es único", () => {
    expect(summary("una bandeja")).toBe("1 bandeja");
    expect(summary("dos hawaianas")).toBe("2 pizza");
    expect(summary("un club colombia")).toBe("1 club");
  });

  it("tolera errores típicos del reconocedor", () => {
    expect(summary("una bandeja paysa")).toBe("1 bandeja");
    expect(summary("una cerbesa poker")).toBe("1 poker");
    expect(summary("dos aguardiente antioqueño")).toBe("2 viejo");
    expect(summary("una limonada natural")).toBe("1 limonada");
    expect(summary("un cafe")).toBe("1 cafe");
  });

  it("'dos' no se confunde con el producto 'Dos Equis'", () => {
    expect(summary("dos cervezas poker")).toBe("2 poker");
    expect(summary("una dos equis")).toBe("1 dosequis");
  });

  it("varias líneas, con y, comas o sin conector", () => {
    expect(summary("dos poker, una bandeja paisa y tres empanadas")).toBe("2 poker | 1 bandeja | 3 empanada");
    expect(summary("cerveza poker y bandeja paisa")).toBe("1 poker | 1 bandeja");
    expect(summary("dos agua tres empanadas")).toBe("2 agua | 3 empanada");
  });

  it("ignora relleno de cortesía", () => {
    const result = parse("ponme por favor dos cervezas poker, gracias");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].quantity).toBe(2);
    expect(result.unparsed).toEqual([]);
  });

  it("nunca vende insumos ni productos inactivos", () => {
    expect(parse("dos tomates").lines.every(l => l.status !== "matched")).toBe(true);
    expect(parse("una sopa del día").lines.every(l => l.status !== "matched")).toBe(true);
  });
});

describe("ambiguos y no encontrados (nunca adivinar en silencio)", () => {
  it("varios productos encajan → ambiguous con opciones", () => {
    const line = parse("dos cervezas águila").lines[0];
    expect(line.status).toBe("ambiguous");
    expect(line.product).toBeNull();
    expect(line.candidates.map(c => c.id).sort()).toEqual(["aguila-light", "aguila-original"]);
    expect(line.quantity).toBe(2);
  });

  it("'cerveza' sola no elige una al azar", () => {
    const line = parse("una cerveza").lines[0];
    expect(line.status).toBe("ambiguous");
    expect(line.candidates.length).toBeGreaterThan(1);
  });

  it("producto inexistente se reporta, no se pierde", () => {
    const result = parse("una bandeja paisa y dos sushis");
    expect(result.lines[0]).toMatchObject({ status: "matched", quantity: 1 });
    expect(result.lines[1]).toMatchObject({ status: "not_found", quantity: 2, spoken: "sushis" });
  });

  it("solo producto inexistente", () => {
    const result = parse("tres choripanes");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ status: "not_found", quantity: 3, spoken: "choripanes" });
  });

  it("un nombre parcial seguido de palabras sin explicar pregunta en vez de adivinar", () => {
    // Existe "Pizza Hawaiana" pero no la de pepperoni: no se debe meter la hawaiana.
    const line = parse("dos pizzas de pepperoni").lines[0];
    expect(line.status).toBe("ambiguous");
    expect(line.product).toBeNull();
    expect(line.candidates.map(c => c.id)).toEqual(["pizza"]);
  });

  it("frase sin nada del menú no agrega nada", () => {
    const result = parse("qué hora es mi amor");
    expect(result.lines.filter(l => l.status === "matched")).toHaveLength(0);
  });
});

describe("exclusiones y notas para cocina", () => {
  it.each([
    ["una hamburguesa clásica sin cebolla", ["sin cebolla"]],
    ["una hamburguesa clásica sin cebolla ni tomate", ["sin cebolla", "sin tomate"]],
    ["una hamburguesa clásica sin cebolla y tomate", ["sin cebolla", "sin tomate"]],
    ["una hamburguesa clásica sin salsa de ajo", ["sin salsa de ajo"]],
    ["una hamburguesa clásica con extra queso", ["extra queso"]],
    ["una hamburguesa clásica con queso y tocineta", ["con queso", "con tocineta"]],
    ["una hamburguesa clásica sin cebolla y con extra queso", ["sin cebolla", "extra queso"]],
    ["una bandeja paisa para llevar", ["para llevar"]],
    ["un café sin azúcar bien caliente", ["sin azúcar", "bien caliente"]],
    ["una limonada natural con poquito hielo", ["poquito hielo"]],
    ["una hamburguesa clásica término medio", ["término medio"]],
    ["una hamburguesa clásica término tres cuartos", ["término tres cuartos"]],
    ["una hamburguesa clásica bien cocida", ["bien cocida"]],
    ["una hamburguesa clásica al punto", ["al punto"]],
    ["una poker bien fría", ["bien fría"]],
    ["una poker helada", ["helada"]]
  ])("%s → %j", (text, notas) => {
    const result = parse(text);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].status).toBe("matched");
    expect(result.lines[0].notes).toEqual(notas);
  });

  it("la nota se queda con SU producto, no con el vecino", () => {
    expect(summary("una hamburguesa clásica sin cebolla y dos poker")).toBe("1 hamburguesa [sin cebolla] | 2 poker");
    expect(summary("dos poker, una hamburguesa clásica sin cebolla y una bandeja paisa para llevar")).toBe(
      "2 poker | 1 hamburguesa [sin cebolla] | 1 bandeja [para llevar]"
    );
  });

  it("'sin ARROZ' no agrega un arroz aunque exista en el catálogo", () => {
    const result = parse("una bandeja paisa sin arroz blanco");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].notes).toEqual(["sin arroz blanco"]);
  });

  it("'un poco de hielo' no inventa un pedido", () => {
    const result = parse("una poker con un poco de hielo");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].notes).toEqual(["poco hielo"]);
  });

  it("'con gusto' / 'con permiso' no son notas de cocina", () => {
    expect(parse("una poker con gusto").lines[0].notes).toEqual([]);
  });
});

describe("pickBestParse (alternativas del reconocedor)", () => {
  it("elige la alternativa que mejor se explica con el catálogo", () => {
    const best = pickBestParse(
      [
        { transcript: "mesa 3 dos cervezas pocker y una vandeja pesa", confidence: 0.4 },
        { transcript: "mesa 3 dos cervezas poker y una bandeja paisa", confidence: 0.3 }
      ],
      CATALOG
    );
    expect(best?.transcript).toBe("mesa 3 dos cervezas poker y una bandeja paisa");
    expect(best?.parsed.lines.map(l => l.product?.id)).toEqual(["poker", "bandeja"]);
  });

  it("empata a favor de la primera alternativa", () => {
    const best = pickBestParse(
      [
        { transcript: "una bandeja paisa", confidence: 0.9 },
        { transcript: "una bandeja paisa ", confidence: 0.8 }
      ],
      CATALOG
    );
    expect(best?.transcript).toBe("una bandeja paisa");
  });

  it("sin alternativas devuelve null", () => {
    expect(pickBestParse([], CATALOG)).toBeNull();
  });
});

describe("helpers", () => {
  it("describeVoiceLine y orderNoteText", () => {
    const line = parse("dos hamburguesas clásicas sin cebolla ni tomate").lines[0];
    expect(orderNoteText(line)).toBe("sin cebolla, sin tomate");
    expect(describeVoiceLine(line)).toBe("2 × Hamburguesa Clásica (sin cebolla, sin tomate)");
    expect(orderNoteText(parse("una poker").lines[0])).toBeUndefined();
  });

  it("catálogo vacío no rompe", () => {
    const result = parseVoiceOrder("dos cervezas", []);
    expect(result.lines.every(l => l.status === "not_found")).toBe(true);
  });

  it("texto vacío", () => {
    const result = parse("   ");
    expect(result.lines).toEqual([]);
    expect(result.tableNumber).toBeNull();
  });
});