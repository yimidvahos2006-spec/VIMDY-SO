import { fileToProductImage, ImageValidationError, type ProductImageOptions } from "./imageUtils";

/**
 * Foto de tarjeta de mesero: se ve a 80 px como máximo, así que 256 px sobra y
 * pesa ~15-30 KB. Antes se guardaba el archivo original completo (varios MB)
 * dentro del registro del mesero, y eso volvía lenta la pantalla Meseros.
 */
export const WAITER_AVATAR_IMAGE: ProductImageOptions = { maxDimension: 256, quality: 0.8 };

/**
 * Convierte la foto elegida en un dataURL comprimido listo para `WaiterEngine`.
 * Lanza un Error con mensaje listo para mostrar si el archivo no sirve.
 */
export async function prepareWaiterPhoto(file: File): Promise<string> {
  try {
    return await fileToProductImage(file, WAITER_AVATAR_IMAGE);
  } catch (error) {
    if (error instanceof ImageValidationError) {
      throw new Error(`WAITER_PHOTO_INVALID: ${error.message}`);
    }
    throw new Error("WAITER_PHOTO_INVALID: No se pudo leer la foto. Prueba con otra imagen.");
  }
}