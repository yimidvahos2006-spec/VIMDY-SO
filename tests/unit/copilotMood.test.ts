import { describe, expect, it } from "vitest";
import {
  containsInsult,
  containsPraise,
  detectReplyReaction,
  detectUserReaction
} from "../../src/presentation/components/copilot/copilotMood";

describe("copilotMood — reacciones del orbe", () => {
  it("detecta insultos con y sin tildes, y en mayúsculas", () => {
    expect(containsInsult("eres un INÚTIL")).toBe(true);
    expect(containsInsult("eres un inutil")).toBe(true);
    expect(containsInsult("qué mierda de respuesta")).toBe(true);
    expect(containsInsult("you are stupid")).toBe(true);
  });

  it("no confunde palabras normales del negocio con insultos", () => {
    expect(containsInsult("¿cuál es mi utilidad bruta?")).toBe(false);
    expect(containsInsult("¿cuánto vendí hoy?")).toBe(false);
    expect(containsInsult("el computador está en la computadora")).toBe(false);
    expect(containsInsult("reputación del negocio")).toBe(false);
  });

  it("detecta felicitaciones, gracias y récords", () => {
    expect(containsPraise("¡Felicitaciones, buen trabajo!")).toBe(true);
    expect(containsPraise("gracias")).toBe(true);
    expect(containsPraise("hoy fue venta récord")).toBe(true);
    expect(containsPraise("¿qué debo comprar?")).toBe(false);
  });

  it("el enojo manda sobre el guiño", () => {
    expect(detectUserReaction("gracias pero eres un idiota")).toBe("angry");
    expect(detectUserReaction("excelente trabajo")).toBe("wink");
    expect(detectUserReaction("¿cuánto vendí?")).toBeNull();
  });

  it("lee el estado del negocio en la respuesta de la IA", () => {
    expect(detectReplyReaction("🔴 Stock bajo en Coca-Cola")).toBe("warning");
    expect(detectReplyReaction("Tienes 3 productos agotados")).toBe("warning");
    expect(detectReplyReaction("¡Nuevo récord de ventas hoy: $2.000.000!")).toBe("wink");
    expect(detectReplyReaction("🟢 Meta cumplida, superaste lo de ayer")).toBe("success");
    expect(detectReplyReaction("Vendiste $350.000 hoy.")).toBeNull();
  });

  it("una alerta pesa más que una buena noticia", () => {
    expect(detectReplyReaction("Meta cumplida, pero hay 2 productos agotados")).toBe("warning");
  });
});