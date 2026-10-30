/** @type {import('tailwindcss').Config} */

/**
 * VIMDY DESIGN SYSTEM v1.0
 * -------------------------------------------------------------
 * Fuente única de verdad para color, radio, espaciado, sombras,
 * transiciones y breakpoints de toda la aplicación.
 *
 * Nadie debe usar un color, radio o sombra fuera de este archivo.
 * Si una pantalla necesita algo que no está aquí, se agrega AQUÍ
 * primero (y se documenta en DESIGN_SYSTEM.md), nunca inline.
 * -------------------------------------------------------------
 */

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    // Breakpoints oficiales (explícitos para que queden documentados
    // aquí y no se hereden "a ciegas" del default de Tailwind).
    screens: {
      sm: "640px",   // móvil grande / tablet vertical
      md: "768px",   // tablet
      lg: "1024px",  // laptop / POS en mostrador
      xl: "1280px",  // desktop
      "2xl": "1536px" // desktop grande / pantallas de gerencia
    },
    extend: {
      colors: {
        vimdy: {
          // --- Fondos ---
          background: "#0A0A0C",           // Fondo principal de la app
          "background-secondary": "#111114", // Sidebar / paneles secundarios

          // --- Superficie ---
          surface: "#18181B",              // Tarjetas
          "surface-hover": "#1F1F23",      // Hover de tarjetas / filas
          "surface-active": "#232327",     // Item activo (nav, selects)

          // --- Bordes ---
          border: "#27272F",               // Borde estándar
          "border-subtle": "#1C1C21",      // Borde casi invisible (separadores)

          // --- Texto ---
          text: "#F5F5F4",                 // Texto principal
          "text-secondary": "#A1A1AA",     // Texto secundario
          "text-tertiary": "#5C5C64",      // Texto deshabilitado / placeholders

          // --- Acento (marca) ---
          accent: "#2563EB",               // Azul principal
          "accent-hover": "#3B82F6",       // Hover / estados activos
          "accent-dark": "#1D4ED8",        // Pressed / texto sobre fondos claros

          // --- Estado ---
          success: "#22C55E",
          "success-bg": "#132018",
          warning: "#F59E0B",
          "warning-hover": "#FBBF24",
          "warning-bg": "#221A0C",
          danger: "#EF4444",
          "danger-hover": "#F87171",
          "danger-bg": "#241315",

          // --- Medallero (ranking de meseros, Dashboard) ---
          gold: "#EAB308",
          silver: "#CBD5E1",
          bronze: "#F97316",

          // --- Acentos de función específica (Inventario) ---
          // Distinguen visualmente una acción de IA o de Recetas/BOM del
          // flujo normal (azul). Un solo tono cada uno, documentado aquí
          // para no repetir "fuchsia-500"/"purple-500" sueltos en el código.
          ai: "#D946EF",
          "ai-hover": "#E879F9",
          recipe: "#A855F7",
          "recipe-hover": "#C084FC",

          // --- Acento decorativo de sección (Dashboard) ---
          // Puramente visual, para diferenciar el bloque "Actividad
          // reciente" del resto — no tiene significado de estado, no
          // confundir con success/warning/danger. No existía ningún tono
          // rosa en la paleta antes de esto (Dashboard.tsx usaba el hex
          // suelto #f472b6 directo en un `color` prop).
          pink: "#F472B6",

          // Fase 3: docs/02_DESIGN_SYSTEM/01_COLOR_SYSTEM.md documenta
          // "VIMDY BLUE #38BDF8" como color de marca, pero nunca se había
          // agregado aquí — useOperationsFeed.ts lo usaba como hex suelto
          // directo (`color: "#38bdf8"`), fuera del token file. Distinto
          // de `accent` (#2563EB, azul interactivo de botones/enlaces):
          // este es el azul de marca/logo, no de interacción.
          blue: "#38BDF8"
        }
      },

      fontFamily: {
        vimdy: ["'Inter'", "'Segoe UI'", "system-ui", "-apple-system", "sans-serif"]
      },

      // Escala tipográfica oficial (usar SIEMPRE estas clases,
      // nunca text-[Npx] suelto en un componente)
      fontSize: {
        "vimdy-h1": ["36px", { lineHeight: "44px", fontWeight: "700", letterSpacing: "-0.01em" }],
        "vimdy-h2": ["25px", { lineHeight: "32px", fontWeight: "600", letterSpacing: "-0.005em" }],
        "vimdy-h3": ["19px", { lineHeight: "26px", fontWeight: "600" }],
        "vimdy-body": ["17px", { lineHeight: "25px", fontWeight: "400" }],
        "vimdy-small": ["15px", { lineHeight: "20px", fontWeight: "400" }],
        "vimdy-micro": ["13px", { lineHeight: "16px", fontWeight: "500", letterSpacing: "0.02em" }]
      },

      // Radio de borde oficial. Más cerrado que la versión anterior
      // para transmitir "software" en vez de "app móvil".
      borderRadius: {
        "vimdy-xs": "6px",   // badges, chips
        "vimdy-sm": "8px",   // inputs, botones pequeños
        "vimdy-md": "12px",  // botones, cards pequeñas
        "vimdy-lg": "16px",  // cards, modales
        "vimdy-xl": "20px",  // paneles grandes, contenedores hero
        "vimdy-2xl": "32px"  // bloque hero de ancho completo (Gerente Inteligente)
      },

      // Escala de espaciado fija — no se permiten valores sueltos (p-[13px], etc.)
      spacing: {
        "vimdy-xs": "4px",
        "vimdy-sm": "8px",
        "vimdy-md": "16px",
        "vimdy-lg": "24px",
        "vimdy-xl": "32px",
        "vimdy-xxl": "48px"
      },

      // Sombras: elevación neutra (negra) para jerarquía de tarjetas,
      // y sombras de acento SOLO para estados interactivos puntuales
      // (focus, botón primario en hover, alertas). Nada de "glow" decorativo.
      boxShadow: {
        "vimdy-xs": "0 1px 2px rgba(0,0,0,0.4)",
        "vimdy-sm": "0 2px 8px rgba(0,0,0,0.45)",
        "vimdy-md": "0 4px 16px rgba(0,0,0,0.5)",
        "vimdy-lg": "0 8px 32px rgba(0,0,0,0.55)",
        "vimdy-accent": "0 0 0 3px rgba(37,99,235,0.25)", // focus ring
        "vimdy-blue": "0 0 24px rgba(37,99,235,0.20)",
        "vimdy-glow": "0 0 40px rgba(37,99,235,0.28)",
        "vimdy-strong": "0 0 60px rgba(37,99,235,0.32)",
        "vimdy-electric": "0 0 24px rgba(37,99,235,0.30)"
      },

      // Duración de transición oficial: 150-250ms, nunca animaciones largas.
      transitionDuration: {
        "vimdy-fast": "150ms",
        "vimdy-normal": "200ms",
        "vimdy-slow": "250ms"
      },

      keyframes: {
        // --- Utilidades funcionales del sistema ---
        "vimdy-fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        "vimdy-slide-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "vimdy-slide-down": {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "vimdy-scale-in": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" }
        },
        "vimdy-pulse": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" }
        },
        "vimdy-spin": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" }
        },

        // --- Legacy: se mantienen los nombres para no romper Kitchen/POS/Voice,
        //     que se rediseñan en el Paso 6/7. Solo se recalibra el color al
        //     nuevo accent (#2563EB) para que no desentonen mientras tanto. ---
        "voice-bar": {
          "0%, 100%": { transform: "scaleY(0.45)" },
          "50%": { transform: "scaleY(1)" }
        },
        "cobrar-glow": {
          "0%, 100%": {
            boxShadow: "0 0 0px 0px rgba(37,99,235,0.0), 0 8px 20px -6px rgba(37,99,235,0.35)"
          },
          "50%": {
            boxShadow: "0 0 18px 2px rgba(37,99,235,0.22), 0 10px 24px -6px rgba(37,99,235,0.45)"
          }
        },
        "voice-idle-glow": {
          "0%, 100%": { boxShadow: "0 0 0px 0px rgba(37,99,235,0)" },
          "50%": { boxShadow: "0 0 10px 1px rgba(37,99,235,0.18)" }
        },
        "kitchen-order-in": {
          "0%": { opacity: "0", transform: "translateY(-14px) scale(0.96)" },
          "60%": { opacity: "1", transform: "translateY(2px) scale(1.01)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" }
        },
        "kitchen-order-glow": {
          "0%, 100%": {
            boxShadow: "0 0 0px 0px rgba(245,158,11,0.0), 0 8px 20px -6px rgba(245,158,11,0.0)"
          },
          "50%": {
            boxShadow: "0 0 22px 3px rgba(245,158,11,0.32), 0 10px 22px -6px rgba(245,158,11,0.42)"
          }
        }
      },

      animation: {
        "vimdy-fade-in": "vimdy-fade-in 200ms ease-out",
        "vimdy-slide-up": "vimdy-slide-up 200ms cubic-bezier(0.16,1,0.3,1)",
        "vimdy-slide-down": "vimdy-slide-down 200ms cubic-bezier(0.16,1,0.3,1)",
        "vimdy-scale-in": "vimdy-scale-in 150ms ease-out",
        "vimdy-pulse": "vimdy-pulse 1.6s ease-in-out infinite",
        "vimdy-spin": "vimdy-spin 0.8s linear infinite",

        "voice-bar-1": "voice-bar 0.9s ease-in-out infinite",
        "voice-bar-2": "voice-bar 0.9s ease-in-out infinite 0.15s",
        "voice-bar-3": "voice-bar 0.9s ease-in-out infinite 0.3s",
        "voice-bar-4": "voice-bar 0.9s ease-in-out infinite 0.45s",
        "cobrar-glow": "cobrar-glow 3s ease-in-out infinite",
        "voice-idle-glow": "voice-idle-glow 3s ease-in-out infinite",
        "kitchen-order-in": "kitchen-order-in 0.5s ease-out",
        "kitchen-order-glow": "kitchen-order-glow 1.25s ease-in-out 4"
      }
    }
  },
  plugins: []
};