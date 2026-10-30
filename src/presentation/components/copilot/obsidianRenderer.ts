/**
 * obsidianRenderer
 * ---------------------------------------------------------------------------
 * Renderiza la esfera de obsidiana líquida del avatar de VIMDY IA con un
 * fragment shader (WebGL).
 *
 * Por qué hay UN solo contexto WebGL compartido: el avatar aparece en la
 * cabecera, en la pantalla principal y en CADA burbuja del chat. Un contexto
 * por avatar agotaría el límite del navegador (~16) en una conversación
 * larga. Aquí se dibuja la esfera una vez por frame en un canvas WebGL
 * fuera de pantalla y cada <AiAvatar> copia ese frame a su propio canvas 2D
 * (drawImage), así que todos los avatares fluyen en sincronía.
 *
 * Ahorro de batería: el bucle solo corre mientras haya algún avatar visible
 * (IntersectionObserver), se pausa con la pestaña oculta y, con
 * prefers-reduced-motion, se dibuja un único cuadro estático.
 */

const VERTEX_SHADER = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;

/* --- Ruido simplex 3D (Ian McEwan, Ashima Arts — MIT) -------------------- */
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

/* --- Superficie líquida --------------------------------------------------
 * Campo de altura sobre la esfera, deformado a su vez por otro ruido
 * (domain warping): da ondas que se enroscan y fluyen como líquido denso,
 * en lugar de manchas que solo se desplazan. */
float surface(vec3 p, float t) {
  vec3 warp = vec3(
    snoise(p * 0.55 + vec3(0.0, t * 0.11, 1.7)),
    snoise(p * 0.55 + vec3(5.2, 1.3, t * 0.10)),
    snoise(p * 0.55 + vec3(t * 0.09, 9.1, 3.3))
  );
  vec3 q = p * 0.62 + warp * 0.95 + vec3(0.0, 0.0, t * 0.07);
  return snoise(q) * 0.90 + snoise(q * 1.9 + 3.7) * 0.10;
}

/* --- Entorno de estudio (lo que "refleja" la obsidiana) -------------------
 * Una caja de luz grande arriba a la izquierda (el brillo curvo del
 * video de referencia), un filo de luz fino a la derecha y un contraluz muy
 * tenue para dibujar el borde. Todo lo demás es negro/carbón. */
vec3 environment(vec3 r) {
  vec3 col = vec3(0.004, 0.004, 0.005);
  col += vec3(0.010, 0.010, 0.013) * smoothstep(-0.6, 0.9, r.y);

  // Caja de luz principal: borde nítido, suave por dentro
  vec3 keyDir = normalize(vec3(-0.66, 0.72, 0.20));
  float key = dot(r, keyDir);
  float keyShape = smoothstep(0.885, 0.905, key);
  col += vec3(0.96, 0.97, 1.00) * keyShape * (0.50 + 0.50 * smoothstep(0.905, 0.985, key));
  col += vec3(0.30, 0.32, 0.36) * smoothstep(0.74, 0.885, key) * 0.22;

  // Segundo filo de luz, pequeño, a la derecha
  vec3 rimDir = normalize(vec3(0.78, 0.38, 0.50));
  col += vec3(0.80, 0.82, 0.88) * smoothstep(0.972, 0.984, dot(r, rimDir)) * 0.30;

  // Relleno inferior, casi imperceptible (carbón)
  vec3 fillDir = normalize(vec3(0.35, -0.75, 0.45));
  col += vec3(0.10, 0.105, 0.12) * smoothstep(0.70, 0.96, dot(r, fillDir)) * 0.25;

  // Contraluz: se ve solo en el borde de la esfera (reflejos rasantes)
  float back = smoothstep(0.0, -0.9, r.z);
  col += vec3(0.075, 0.08, 0.095) * back * (0.5 + 0.5 * smoothstep(-0.8, 0.8, r.x * 0.6 - r.y * 0.5));
  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float r2 = dot(uv, uv);
  float r = sqrt(r2);

  // Silueta con antialias de ~1px
  float px = 2.0 / uRes.y;
  float mask = 1.0 - smoothstep(1.0 - px * 1.5, 1.0, r);
  if (mask <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float z = sqrt(max(1.0 - r2, 0.0));
  vec3 n0 = vec3(uv, z);

  // Giro lento de la esfera + flujo del líquido
  float t = uTime;
  float c = cos(t * 0.05);
  float s = sin(t * 0.05);
  vec3 p = vec3(c * n0.x + s * n0.z, n0.y, -s * n0.x + c * n0.z);

  // Gradiente del campo de altura (diferencias finitas) -> normal perturbada
  float e = 0.06;
  float h0 = surface(p, t);
  float hx = surface(p + vec3(e, 0.0, 0.0), t);
  float hy = surface(p + vec3(0.0, e, 0.0), t);
  float hz = surface(p + vec3(0.0, 0.0, e), t);
  vec3 grad = vec3(hx - h0, hy - h0, hz - h0) / e;

  // Solo la parte tangente a la superficie deforma la normal
  grad -= dot(grad, p) * p;
  // Gira el gradiente de vuelta al espacio de pantalla
  vec3 gradView = vec3(c * grad.x - s * grad.z, grad.y, s * grad.x + c * grad.z);
  vec3 n = normalize(n0 - gradView * 0.15);

  vec3 view = vec3(0.0, 0.0, 1.0);
  vec3 refl = reflect(-view, n);

  float ndv = clamp(dot(n, view), 0.0, 1.0);
  float fresnel = pow(1.0 - ndv, 3.0);

  // Cuerpo: negro profundo con una veta de carbón que respira con la superficie
  float body = 0.5 + 0.5 * h0;
  vec3 baseCol = mix(vec3(0.002, 0.002, 0.003), vec3(0.014, 0.015, 0.019), body * 0.75 + 0.25 * (1.0 - r));

  // Reflejo: obsidiana = brillo alto pero solo donde el entorno tiene luz
  float specAmount = 0.30 + 0.70 * fresnel;
  vec3 col = baseCol + environment(refl) * specAmount;

  // Borde de cristal: filo gris muy fino, más presente abajo a la derecha
  float edge = smoothstep(0.80, 1.0, r);
  float edgeDir = 0.55 + 0.45 * smoothstep(-0.8, 0.9, uv.x * 0.7 - uv.y * 0.7);
  col += vec3(0.075, 0.08, 0.092) * edge * edge * edgeDir * (0.7 + 0.3 * h0);

  // Viñeta interior: profundidad, el centro nunca pasa de carbón
  col *= mix(1.0, 0.72, smoothstep(0.0, 0.85, 1.0 - r) * 0.5);

  // Un toque de curva de tono para mantener los negros limpios
  col = col / (1.0 + col * 0.55);
  col = pow(col, vec3(0.92));

  gl_FragColor = vec4(col * mask, mask);
}
`;

const MIN_RENDER_PX = 64;
const MAX_RENDER_PX = 512;
/** Tiempo fijo (s) del cuadro estático cuando el usuario pide menos movimiento. */
const STATIC_FRAME_TIME = 7.5;

interface Subscriber {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  visible: boolean;
}

class ObsidianRenderer {
  private glCanvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private renderPx = 0;
  private failed = false;
  private rafId = 0;
  private readonly startedAt = typeof performance !== "undefined" ? performance.now() : 0;
  private readonly subscribers = new Set<Subscriber>();
  private reducedMotion = false;
  private listening = false;

  /** true si WebGL está disponible y el shader compiló. */
  public isSupported(): boolean {
    this.ensureContext();
    return !this.failed;
  }

  public register(canvas: HTMLCanvasElement): { setVisible: (v: boolean) => void; dispose: () => void; redraw: () => void } | null {
    this.ensureContext();
    if (this.failed) return null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    this.attachGlobalListeners();
    const sub: Subscriber = { canvas, ctx, visible: true };
    this.subscribers.add(sub);
    this.schedule();

    return {
      setVisible: (visible: boolean) => {
        sub.visible = visible;
        if (visible) this.schedule();
      },
      redraw: () => this.schedule(),
      dispose: () => {
        this.subscribers.delete(sub);
        if (this.subscribers.size === 0) this.stop();
      }
    };
  }

  /* ---------------------------------------------------------------------- */

  private attachGlobalListeners(): void {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;

    if (typeof window.matchMedia === "function") {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion = query.matches;
      const onChange = (event: MediaQueryListEvent) => {
        this.reducedMotion = event.matches;
        this.schedule();
      };
      if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
      else this.schedule();
    });
  }

  private ensureContext(): void {
    if (this.gl || this.failed) return;
    if (typeof document === "undefined") {
      this.failed = true;
      return;
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;

      const gl = (canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "low-power"
      }) as WebGLRenderingContext | null);
      if (!gl) throw new Error("WebGL no disponible");

      const program = this.buildProgram(gl);
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(program, "aPos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);

      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        this.stop();
        this.gl = null;
        this.glCanvas = null;
      });
      canvas.addEventListener("webglcontextrestored", () => {
        this.gl = null;
        this.glCanvas = null;
        this.renderPx = 0;
        this.ensureContext();
        this.schedule();
      });

      this.glCanvas = canvas;
      this.gl = gl;
      this.uRes = gl.getUniformLocation(program, "uRes");
      this.uTime = gl.getUniformLocation(program, "uTime");
      this.renderPx = 256;
    } catch {
      this.failed = true;
      this.gl = null;
      this.glCanvas = null;
    }
  }

  private buildProgram(gl: WebGLRenderingContext): WebGLProgram {
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("No se pudo crear el shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader inválido: ${log ?? ""}`);
      }
      return shader;
    };

    const program = gl.createProgram();
    if (!program) throw new Error("No se pudo crear el programa");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Programa inválido: ${gl.getProgramInfoLog(program) ?? ""}`);
    }
    return program;
  }

  private schedule(): void {
    if (this.rafId || this.failed || typeof window === "undefined") return;
    if (document.hidden) return;
    if (!this.hasVisibleSubscribers()) return;
    this.rafId = window.requestAnimationFrame(this.frame);
  }

  private stop(): void {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private hasVisibleSubscribers(): boolean {
    for (const sub of this.subscribers) if (sub.visible) return true;
    return false;
  }

  private frame = (now: number): void => {
    this.rafId = 0;
    if (!this.gl || !this.glCanvas || !this.hasVisibleSubscribers()) return;

    // El lienzo WebGL se dimensiona al avatar visible más grande.
    let neededPx = MIN_RENDER_PX;
    for (const sub of this.subscribers) {
      if (sub.visible) neededPx = Math.max(neededPx, sub.canvas.width, sub.canvas.height);
    }
    neededPx = Math.min(MAX_RENDER_PX, Math.ceil(neededPx / 16) * 16);

    const gl = this.gl;
    if (neededPx !== this.renderPx) {
      this.glCanvas.width = neededPx;
      this.glCanvas.height = neededPx;
      this.renderPx = neededPx;
      gl.viewport(0, 0, neededPx, neededPx);
    }

    const time = this.reducedMotion ? STATIC_FRAME_TIME : (now - this.startedAt) / 1000 + STATIC_FRAME_TIME;
    gl.uniform2f(this.uRes, neededPx, neededPx);
    gl.uniform1f(this.uTime, time);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    for (const sub of this.subscribers) {
      if (!sub.visible) continue;
      const { canvas, ctx } = sub;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.glCanvas, 0, 0, neededPx, neededPx, 0, 0, canvas.width, canvas.height);
    }

    // Con movimiento reducido: un único cuadro estático, sin bucle.
    if (!this.reducedMotion) this.schedule();
  };
}

export const obsidianRenderer = new ObsidianRenderer();