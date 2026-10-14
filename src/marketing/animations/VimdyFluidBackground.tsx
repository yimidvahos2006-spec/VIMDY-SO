import { useEffect, useRef } from "react";

interface VimdyFluidBackgroundProps {
  /** Clases extra para el contenedor (por ejemplo, para bajar la opacidad). */
  className?: string;
}

/**
 * Fondo vivo de VIMDY: una mancha de fluido azul que se mueve despacio sobre negro
 * y sigue el mouse con suavidad. Se dibuja con WebGL en un solo pase de shader.
 *
 * Uso: ponlo como primer hijo de una sección con `relative isolate overflow-hidden`.
 * Ocupa todo el contenedor (absolute inset-0) y queda detrás del contenido (-z-10).
 *
 * - Se pausa cuando la sección no se ve o la pestaña está oculta.
 * - Respeta "reducir movimiento": dibuja un solo cuadro fijo.
 * - Si el navegador no soporta WebGL, queda el degradado azul de respaldo.
 */

const VERTEX_SHADER = `
attribute vec2 p;
void main() {
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 uR;
uniform float uT;
uniform vec2 uM;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = p * 2.02 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uR) / uR.y;
  float t = uT * 0.15;

  vec2 q = vec2(fbm(p * 0.9 + vec2(0.0, t)), fbm(p * 0.9 + vec2(5.2, 1.3) - t));
  vec2 r = vec2(
    fbm(p * 0.75 + 2.0 * q + vec2(1.7, 9.2) + t * 1.3),
    fbm(p * 0.75 + 2.0 * q + vec2(8.3, 2.8) - t)
  );
  float v = fbm(p * 0.7 + 3.4 * r);

  vec2 m = (uM - 0.5) * vec2(uR.x / uR.y, 1.0);
  float d = length(p - m);
  v += 0.30 * exp(-d * d * 7.0);

  float core = smoothstep(0.44, 0.56, v);
  float halo = smoothstep(0.16, 0.50, v);

  vec3 bg = vec3(0.010, 0.022, 0.050);
  vec3 mid = vec3(0.008, 0.045, 0.26);
  vec3 hot = vec3(0.035, 0.30, 1.0);

  vec3 col = mix(bg, mid, halo * halo);
  col = mix(col, hot, core);
  col += vec3(0.05, 0.14, 0.35) * pow(core, 3.0) * 0.35;
  col += (hash(gl_FragCoord.xy + uT) - 0.5) / 190.0;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function VimdyFluidBackground({ className = "" }: VimdyFluidBackgroundProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const host = wrapper.parentElement ?? wrapper;
    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });

    if (!gl) {
      canvas.style.display = "none";
      return;
    }

    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    const buffer = gl.createBuffer();

    const dispose = () => {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    };

    if (!vertex || !fragment || !program || !buffer) {
      dispose();
      canvas.style.display = "none";
      return;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      dispose();
      canvas.style.display = "none";
      return;
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "uR");
    const uTime = gl.getUniformLocation(program, "uT");
    const uMouse = gl.getUniformLocation(program, "uM");

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const startedAt = performance.now();
    let mouseX = 0.72;
    let mouseY = 0.55;
    let targetX = 0.72;
    let targetY = 0.55;
    let inView = true;
    let tabVisible = !document.hidden;
    let frameId = 0;

    const resize = () => {
      // Se dibuja a baja resolución: el fluido es suave y así gasta poco.
      const scale = Math.min(0.5, 1000 / Math.max(1, host.clientWidth));
      const width = Math.max(2, Math.floor(host.clientWidth * scale));
      const height = Math.max(2, Math.floor(host.clientHeight * scale));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };

    const draw = (now: number) => {
      mouseX += (targetX - mouseX) * 0.04;
      mouseY += (targetY - mouseY) * 0.04;
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, reduceMotion ? 6 : (now - startedAt) / 1000 + 6);
      gl.uniform2f(uMouse, mouseX, mouseY);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = (now: number) => {
      if (inView && tabVisible) draw(now);
      frameId = window.requestAnimationFrame(loop);
    };

    const onPointerMove = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      targetX = (event.clientX - box.left) / box.width;
      targetY = 1 - (event.clientY - box.top) / box.height;
    };

    const onVisibility = () => {
      tabVisible = !document.hidden;
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      window.cancelAnimationFrame(frameId);
      canvas.style.display = "none";
    };

    const onResize = () => {
      resize();
      if (reduceMotion) draw(performance.now());
    };

    resize();

    host.addEventListener("pointermove", onPointerMove);
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onContextLost);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(host);
    } else {
      window.addEventListener("resize", onResize);
    }

    let intersectionObserver: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          inView = entries[0]?.isIntersecting ?? true;
        },
        { threshold: 0 },
      );
      intersectionObserver.observe(host);
    }

    if (reduceMotion) {
      draw(performance.now());
    } else {
      frameId = window.requestAnimationFrame(loop);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      host.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      dispose();
      // No se pierde el contexto a propósito: en desarrollo React monta el componente
      // dos veces sobre el mismo canvas y un contexto perdido dejaría el fondo apagado.
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[radial-gradient(60%_70%_at_70%_40%,#0a4dfa_0%,#06185f_40%,#05070a_75%)] ${className}`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(5,7,10,0.35),transparent_70%)]" />
      <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-b from-transparent to-[#05070a]" />
    </div>
  );
}