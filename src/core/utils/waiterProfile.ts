/* ===========================================================================
   waiterProfile
   ---------------------------------------------------------------------------
   Reglas puras de la tarjeta de un mesero (nombre y foto). Las usan
   WaiterEngine (para que ninguna pantalla pueda saltárselas) y la pantalla de
   Configuración (para avisar antes de guardar).
=========================================================================== */

export const WAITER_NAME_MAX_LENGTH = 40;

/** Una foto de tarjeta pesa ~15-30 KB (256 px JPEG). Más de esto ya no es una foto de tarjeta. */
export const WAITER_PHOTO_MAX_CHARS = 300_000;

/** "  juan   pérez " → "juan pérez" (se conserva cómo lo escribió el dueño). */
export function normalizeWaiterName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** Llave para comparar nombres: sin tildes ni mayúsculas ("José" == "jose"). */
export function waiterNameKey(name: string): string {
  return normalizeWaiterName(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const DATA_IMAGE_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/**
 * Solo se aceptan fotos como imagen embebida (la que genera la pantalla) o un
 * enlace https. Nada de `javascript:`, `data:text/html`, SVG con scripts, etc.
 * Devuelve el motivo si NO es válida, o `null` si está bien.
 */
export function waiterPhotoProblem(photoUrl: string): string | null {
  const value = photoUrl.trim();
  if (!value) return "La foto está vacía.";
  if (value.length > WAITER_PHOTO_MAX_CHARS) {
    return "La foto es demasiado pesada. Elige una más pequeña.";
  }
  if (value.startsWith("data:")) {
    return DATA_IMAGE_PATTERN.test(value) ? null : "La foto no es válida. Usa una imagen PNG, JPG o WEBP.";
  }
  if (/^https:\/\//i.test(value)) return null;
  return "La foto no es válida. Usa una imagen PNG, JPG o WEBP.";
}