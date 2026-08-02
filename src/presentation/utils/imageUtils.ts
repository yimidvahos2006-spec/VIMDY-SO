/* ===========================================================================
   imageUtils
   ---------------------------------------------------------------------------
   VIMDY no tiene backend/servidor de archivos: todo vive en IndexedDB en el
   navegador. Por eso la imagen de un producto se guarda como un dataURL
   (string base64) directamente en Product.image, igual que cualquier otro
   campo. Este archivo es el único punto donde se procesa esa conversión,
   para que el formulario de Productos no tenga que saber nada de canvas,
   compresión ni límites de tamaño.
=========================================================================== */

const MAX_SOURCE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB de archivo original como máximo
const MAX_DIMENSION_PX = 800; // ancho/alto máximo del producto final
const JPEG_QUALITY = 0.82;

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export class ImageValidationError extends Error {}

/**
 * Valida el archivo elegido por el usuario antes de procesarlo.
 * Lanza ImageValidationError con un mensaje ya listo para mostrar en la UI.
 */
export function validateImageFile(file: File): void {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new ImageValidationError(
      "Formato no soportado. Usa una imagen PNG, JPG, WEBP o GIF."
    );
  }

  if (file.size > MAX_SOURCE_SIZE_BYTES) {
    throw new ImageValidationError(
      "La imagen es demasiado pesada (máximo 8MB)."
    );
  }
}

/**
 * Convierte un File de imagen en un dataURL JPEG comprimido y redimensionado
 * (máximo 800px de lado), listo para guardarse en Product.image.
 */
export async function fileToProductImage(file: File): Promise<string> {
  validateImageFile(file);

  const original = await readFileAsDataUrl(file);
  const bitmap = await loadImage(original);

  const { width, height } = fitDimensions(
    bitmap.width,
    bitmap.height,
    MAX_DIMENSION_PX
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Si el navegador no soporta canvas 2D (muy raro), degradamos al
    // original en vez de romper el flujo de creación de producto.
    return original;
  }

  // Fondo blanco para que los PNG/GIF con transparencia no queden negros
  // al convertirse a JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo de imagen."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("El archivo no es una imagen válida."));
    img.src = src;
  });
}

function fitDimensions(
  width: number,
  height: number,
  maxSize: number
): { width: number; height: number } {
  if (width <= maxSize && height <= maxSize) {
    return { width, height };
  }

  const ratio = width > height ? maxSize / width : maxSize / height;

  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio)
  };
}