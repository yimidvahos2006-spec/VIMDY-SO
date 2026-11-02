/**
 * Membrete tipográfico automático (Smart Typography Header).
 *
 * Cuando el negocio no tiene logo (`business.logo` vacío/ausente), el ticket
 * dibuja una insignia (badge) con el NOMBRE del negocio: tipografía limpia,
 * en negrita, mayúsculas con tracking amplio y doble marco minimalista.
 * Es HTML + CSS puro (sin imágenes ni red), así que funciona igual en la
 * vista previa, en la impresión y al exportar a PDF desde el diálogo de
 * impresión, incluso sin internet.
 *
 * Pensado para térmicas: solo líneas (sin rellenos de color sólido) para no
 * gastar tinta ni "empastar" el papel. El color de acento se aplica solo en
 * las plantillas que lo soportan; el resto imprime en negro.
 */

/** Nombres de fábrica / vacíos que no son una marca real. */
const PLACEHOLDER_NAMES = new Set(["", "vimdy demo"]);

export const TYPOGRAPHIC_LOGO_FALLBACK_NAME = "VIMDY";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** ¿Hay un logo (imagen) utilizable? */
export function hasLogoImage(logo: string | null | undefined): boolean {
  return Boolean(logo && logo.trim());
}

/** Nombre que se imprime en la insignia: limpio, sin espacios dobles. */
export function typographicLogoName(name: string | null | undefined): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (PLACEHOLDER_NAMES.has(clean.toLowerCase())) return TYPOGRAPHIC_LOGO_FALLBACK_NAME;
  return clean;
}

/**
 * Escala la fuente según el largo del nombre para que un nombre largo siga
 * cabiendo en el marco sin cortarse (en lugar de truncar, baja el tamaño).
 */
function badgeFontSizeEm(name: string): number {
  const len = name.length;
  if (len <= 10) return 1.25;
  if (len <= 16) return 1.05;
  if (len <= 24) return 0.9;
  return 0.78;
}

/** HTML de la insignia. `name` ya debe venir de `typographicLogoName`. */
export function renderTypographicBadge(name: string): string {
  const size = badgeFontSizeEm(name);
  return `
    <div class="brand-badge" role="img" aria-label="${escapeHtml(name)}">
      <div class="brand-badge-inner">
        <span class="brand-badge-name" style="font-size:${size}em">${escapeHtml(name)}</span>
      </div>
    </div>`;
}

/**
 * CSS de la insignia. `accent` es el color de acento ya resuelto; solo se
 * usa si `useAccent` es true (plantillas que lo muestran).
 */
export function typographicBadgeCss(accent: string, useAccent: boolean): string {
  const ink = useAccent ? accent : "#111";
  return `
    .brand-badge {
      display: table;
      margin: 2px auto 10px;
      padding: 3px;
      border: 1.5px solid ${ink};
      border-radius: 6px;
      max-width: 100%;
    }
    .brand-badge-inner {
      border: 1px solid ${ink};
      border-radius: 4px;
      padding: 7px 16px;
      text-align: center;
    }
    .brand-badge-name {
      display: block;
      font-family: 'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .22em;
      /* el tracking suma un hueco al final: se compensa para centrar óptico */
      margin-right: -.22em;
      line-height: 1.15;
      color: ${ink};
      overflow-wrap: anywhere;
      word-break: break-word;
    }
  `;
}