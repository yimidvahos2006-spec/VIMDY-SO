import { useEffect, useRef } from "react";
import * as THREE from "three";

interface VimdyWaveBackgroundProps {
  className?: string;
}

const RIBBON_COUNT_DESKTOP = 15;
const RIBBON_COUNT_MOBILE = 8;
const MOBILE_BREAKPOINT = 768;

const VERTEX_SHADER = `
  attribute float aU;
  uniform float uTime, uFreq, uAmp, uPhase, uSpeed, uZWiggle;
  varying float vU;
  varying float vEnv;
  void main() {
    vU = aU;
    float env = sin(aU * 3.14159265);
    vEnv = env;
    float wave = uAmp * sin(uFreq * aU * 6.2831853 + uTime * uSpeed + uPhase) * env;
    float wobbleZ = uZWiggle * sin(uFreq * 0.5 * aU * 6.2831853 - uTime * uSpeed * 0.6 + uPhase) * env;
    vec3 pos = position;
    pos.y += wave;
    pos.z += wobbleZ;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  varying float vU;
  varying float vEnv;
  uniform vec3 cA, cB, cC;
  void main() {
    vec3 col = mix(cA, cB, smoothstep(0.0, 0.55, vU));
    col = mix(col, cC, smoothstep(0.55, 1.0, vU));
    float alpha = 0.9 * (0.25 + 0.75 * vEnv);
    gl_FragColor = vec4(col, alpha);
  }
`;

/**
 * Fondo animado "campo de ondas" en el azul de marca VIMDY.
 * Reemplazo drop-in de VimdyAmbientBackground para MarketingLayout.
 * Respeta prefers-reduced-motion y reduce carga en móvil.
 */
export function VimdyWaveBackground({ className = "" }: VimdyWaveBackgroundProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motionQuery.matches) return; // fondo estático: no montamos WebGL

    const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    const ribbonCount = isMobile ? RIBBON_COUNT_MOBILE : RIBBON_COUNT_DESKTOP;

    const sceneCanvas = document.createElement("canvas");
    const glowCanvas = document.createElement("canvas");
    sceneCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    glowCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;mix-blend-mode:screen;opacity:.85;pointer-events:none";
    mount.appendChild(sceneCanvas);
    mount.appendChild(glowCanvas);
    const glowCtx = glowCanvas.getContext("2d");

    const renderer = new THREE.WebGLRenderer({ canvas: sceneCanvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.3 : 2));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);
    scene.fog = new THREE.FogExp2(0x05060a, 0.028);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    let camRadius = 34, camTheta = 0.15, camPhi = 1.35;
    const updateCamera = () => {
      camera.position.set(
        camRadius * Math.sin(camPhi) * Math.sin(camTheta),
        camRadius * Math.cos(camPhi),
        camRadius * Math.sin(camPhi) * Math.cos(camTheta),
      );
      camera.lookAt(0, 0, 0);
    };
    updateCamera();

    // Paleta de marca VIMDY
    const cLight = new THREE.Color(0x7dd3fc);
    const cMid = new THREE.Color(0x38bdf8);
    const cBrand = new THREE.Color(0x2563eb);
    const cDeep = new THREE.Color(0x12224f);

    const ribbons: THREE.ShaderMaterial[] = [];
    const geometries: THREE.BufferGeometry[] = [];

    for (let i = 0; i < ribbonCount; i++) {
      const t = i / (ribbonCount - 1);
      const len = 46 + Math.random() * 6;
      const baseY = (t - 0.5) * 20;
      const baseZ = (Math.random() - 0.5) * 18;
      const tilt = (Math.random() - 0.5) * 0.5;

      const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-len / 2, baseY, baseZ),
        new THREE.Vector3(-len / 6, baseY + tilt * 4, baseZ * 0.5),
        new THREE.Vector3(len / 6, baseY - tilt * 4, -baseZ * 0.5),
        new THREE.Vector3(len / 2, baseY, baseZ),
      ]);
      const radius = 0.035 + Math.random() * 0.035;
      const geo = new THREE.TubeGeometry(path, isMobile ? 60 : 120, radius, 6, false);

      const uv = geo.attributes.uv;
      const aU = new Float32Array(uv.count);
      for (let v = 0; v < uv.count; v++) aU[v] = uv.getX(v);
      geo.setAttribute("aU", new THREE.BufferAttribute(aU, 1));
      geometries.push(geo);

      const isBright = i % 4 === 0;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
          uTime: { value: 0 },
          uFreq: { value: 0.6 + Math.random() * 1.1 },
          uAmp: { value: 1.2 + Math.random() * 2.2 },
          uPhase: { value: Math.random() * Math.PI * 2 },
          uSpeed: { value: 0.35 + Math.random() * 0.5 },
          uZWiggle: { value: 1.0 + Math.random() * 2.0 },
          cA: { value: isBright ? cLight.clone() : cDeep.clone() },
          cB: { value: cMid.clone() },
          cC: { value: cBrand.clone() },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      scene.add(new THREE.Mesh(geo, mat));
      ribbons.push(mat);
    }

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h, true);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      glowCanvas.width = Math.floor(w * 0.5);
      glowCanvas.height = Math.floor(h * 0.5);
    };
    resize();
    window.addEventListener("resize", resize, { passive: true });

    // arrastrar para mover la perspectiva (deshabilitado en móvil para no interferir con el scroll)
    let dragging = false, lastX = 0, lastY = 0;
    const down = (x: number, y: number) => { dragging = true; lastX = x; lastY = y; };
    const move = (x: number, y: number) => {
      if (!dragging) return;
      camTheta += (x - lastX) * 0.004;
      camPhi = Math.min(2.4, Math.max(0.6, camPhi + (y - lastY) * 0.003));
      lastX = x; lastY = y;
    };
    const up = () => { dragging = false; };
    if (!isMobile) {
      sceneCanvas.addEventListener("mousedown", (e) => down(e.clientX, e.clientY));
      window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
      window.addEventListener("mouseup", up);
    }

    let raf = 0;
    const clock = new THREE.Clock();
    let running = true;

    const animate = () => {
      if (!running) return;
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      ribbons.forEach((m) => (m.uniforms.uTime.value = t));
      camTheta += 0.0006;
      updateCamera();
      renderer.render(scene, camera);
      if (glowCtx) {
        try {
          glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
          glowCtx.filter = "blur(9px) brightness(1.7)";
          glowCtx.drawImage(sceneCanvas, 0, 0, glowCanvas.width, glowCanvas.height);
        } catch {
          /* no-op */
        }
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else {
        running = true;
        raf = requestAnimationFrame(animate);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    raf = requestAnimationFrame(animate);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      geometries.forEach((g) => g.dispose());
      ribbons.forEach((m) => m.dispose());
      renderer.dispose();
      mount.removeChild(sceneCanvas);
      mount.removeChild(glowCanvas);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className={`pointer-events-none fixed inset-0 h-full w-full ${className}`}
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
}