import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prepareWaiterPhoto, WAITER_AVATAR_IMAGE } from "../../src/presentation/utils/waiterPhoto";
import { waiterPhotoProblem } from "../../src/core/utils/waiterProfile";

interface FakeCanvas {
  width: number;
  height: number;
  getContext: () => { fillStyle: string; fillRect: () => void; drawImage: () => void };
  toDataURL: ReturnType<typeof vi.fn>;
}

let canvas: FakeCanvas;
let sourceSize = { width: 4000, height: 3000 };

function stubBrowser() {
  canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: "", fillRect: () => undefined, drawImage: () => undefined }),
    toDataURL: vi.fn(() => "data:image/jpeg;base64,/9j/AAAA"),
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal(
    "FileReader",
    class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.result = "data:image/jpeg;base64,ORIGINAL";
        this.onload?.();
      }
    },
  );
  vi.stubGlobal(
    "Image",
    class {
      width = sourceSize.width;
      height = sourceSize.height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
}

function photo(type = "image/jpeg", size = 1024): File {
  return { type, size, name: "foto" } as File;
}

beforeEach(() => {
  sourceSize = { width: 4000, height: 3000 };
  stubBrowser();
});
afterEach(() => vi.unstubAllGlobals());

describe("foto de mesero: compresión a 256 px", () => {
  it("la configuración es 256 px máximo y calidad 0.8", () => {
    expect(WAITER_AVATAR_IMAGE).toEqual({ maxDimension: 256, quality: 0.8 });
  });

  it("una foto horizontal grande queda en 256 de ancho conservando proporción", async () => {
    sourceSize = { width: 4000, height: 3000 };
    await prepareWaiterPhoto(photo());
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(192);
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.8);
  });

  it("una foto vertical queda en 256 de alto", async () => {
    sourceSize = { width: 3000, height: 4000 };
    await prepareWaiterPhoto(photo());
    expect(canvas.height).toBe(256);
    expect(canvas.width).toBe(192);
  });

  it("una foto cuadrada queda en 256 x 256", async () => {
    sourceSize = { width: 1200, height: 1200 };
    await prepareWaiterPhoto(photo());
    expect([canvas.width, canvas.height]).toEqual([256, 256]);
  });

  it("una foto que ya es pequeña no se agranda", async () => {
    sourceSize = { width: 120, height: 90 };
    await prepareWaiterPhoto(photo());
    expect([canvas.width, canvas.height]).toEqual([120, 90]);
  });

  it("nunca deja un lado por encima de 256 px", async () => {
    for (const [width, height] of [[257, 10], [10, 257], [5000, 5000], [1920, 1080]]) {
      sourceSize = { width, height };
      await prepareWaiterPhoto(photo());
      expect(Math.max(canvas.width, canvas.height), `${width}x${height}`).toBeLessThanOrEqual(256);
    }
  });

  it("el resultado pasa la validación que usa WaiterEngine", async () => {
    const result = await prepareWaiterPhoto(photo());
    expect(waiterPhotoProblem(result)).toBeNull();
  });

  it("un archivo que no es imagen o es demasiado pesado se rechaza con mensaje claro", async () => {
    await expect(prepareWaiterPhoto(photo("application/pdf"))).rejects.toThrow(/^WAITER_PHOTO_INVALID: Formato no soportado/);
    await expect(prepareWaiterPhoto(photo("image/png", 9 * 1024 * 1024))).rejects.toThrow(/^WAITER_PHOTO_INVALID: .*8MB/);
  });

  it("si el navegador no puede leer la imagen, el error sigue siendo legible", async () => {
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    await expect(prepareWaiterPhoto(photo())).rejects.toThrow(/^WAITER_PHOTO_INVALID: No se pudo leer la foto/);
  });
});