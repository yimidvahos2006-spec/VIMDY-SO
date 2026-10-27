import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * introScene
 * ---------------------------------------------------------------------------
 * Escena 3D de la intro cinematográfica de VIMDY (solo para quien crea la
 * cuenta; ver OnboardingGate). Todo es una función del tiempo: renderAt(t)
 * dibuja el cuadro exacto del segundo t, sin estado oculto. Así la intro se
 * ve igual en cualquier computador y se puede revisar cuadro por cuadro.
 *
 * Colores: SOLO los de marca. Fondo #0A0A0C, azul #2563EB / #1D4ED8 /
 * #3B82F6, celeste #38BDF8 y blanco. Nada de violeta ni colores nuevos.
 *
 * Línea de tiempo (segundos):
 *   0.0 – 0.5  negro
 *   0.5 – 2.7  terrazas azules que se levantan; una luz celeste las recorre
 *   2.7 – 3.2  la cámara se lanza hacia la luz, bloom al máximo (destello)
 *   3.2 – 3.6  la V de VIMDY emerge del destello
 *   3.6 – 5.0  la V se sostiene, un reflejo la recorre
 */

export const INTRO_TOTAL_SECONDS = 5.2;
export const INTRO_LOGO_SECONDS = 3.2;

const BLUE = 0x2563eb;
const BLUE_DARK = 0x1d4ed8;
const BLUE_LIGHT = 0x3b82f6;
const SKY = 0x38bdf8;
const BG = 0x0a0a0c;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface IntroScene {
  renderAt(seconds: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

interface Terrace {
  mesh: THREE.Mesh;
  index: number;
  height: number;
}

function buildTerraces(): { group: THREE.Group; terraces: Terrace[] } {
  const group = new THREE.Group();
  const terraces: Terrace[] = [];
  const COUNT = 11;

  for (let i = 0; i < COUNT; i += 1) {
    const inner = 1.5 + i * 0.5;
    const outer = inner + 0.44;
    const height = 0.28 + i * 0.2;
    const start = -0.12 * Math.PI;
    const end = 1.12 * Math.PI;

    const shape = new THREE.Shape();
    shape.absarc(0, 0, outer, start, end, false);
    shape.absarc(0, 0, inner, end, start, true);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.035,
      bevelSegments: 3,
      curveSegments: 72
    });
    geometry.rotateX(-Math.PI / 2);

    const mix = i / (COUNT - 1);
    const color = new THREE.Color(BLUE_DARK).lerp(new THREE.Color(BLUE), mix * 0.5).multiplyScalar(0.55);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.38,
      metalness: 0.7
    });

    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    terraces.push({ mesh, index: i, height });
  }

  return { group, terraces };
}

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Isotipo oficial: tile oscuro con la V (M30 30 L50 66 L70 30, trazo 9) en 3D. */
function buildLogo(): { group: THREE.Group; vMaterial: THREE.MeshPhysicalMaterial } {
  const group = new THREE.Group();
  const unit = 0.034; // 100 unidades del SVG -> 3.4 unidades de escena

  const tileGeo = new THREE.ExtrudeGeometry(roundedRectShape(97 * unit, 97 * unit, 24 * unit), {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 4
  });
  tileGeo.translate(0, 0, -0.12);
  const tile = new THREE.Mesh(
    tileGeo,
    new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.55, metalness: 0.35 })
  );
  group.add(tile);

  const vMaterial = new THREE.MeshPhysicalMaterial({
    color: BLUE,
    emissive: SKY,
    emissiveIntensity: 0.12,
    roughness: 0.22,
    metalness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.12
  });

  const p = (x: number, y: number) => new THREE.Vector3((x - 50) * unit, (50 - y) * unit + 0.02, 0.02);
  const pts = [p(30, 30), p(50, 66), p(70, 30)];
  const radius = 5.6 * unit;

  for (let i = 0; i < 2; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const dir = b.clone().sub(a);
    const length = dir.length();
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 24), vMaterial);
    capsule.position.copy(a.clone().add(b).multiplyScalar(0.5));
    capsule.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    capsule.scale.z = 0.9;
    group.add(capsule);
  }

  return { group, vMaterial };
}

function buildDust(): THREE.Points {
  const count = 160;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 18;
    positions[i * 3 + 1] = Math.random() * 7 - 1;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 14;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: SKY,
    size: 0.035,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  return new THREE.Points(geometry, material);
}

export function createIntroScene(canvas: HTMLCanvasElement, pixelRatio = 1): IntroScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(BG, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.045);

  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 80);

  const { group: terraceGroup, terraces } = buildTerraces();
  scene.add(terraceGroup);

  const { group: logoGroup, vMaterial } = buildLogo();
  logoGroup.visible = false;
  scene.add(logoGroup);

  const dust = buildDust();
  scene.add(dust);

  // Luces: relleno azul muy suave, borde azul desde atrás y el foco celeste que barre.
  scene.add(new THREE.AmbientLight(BLUE, 0.06));
  const rim = new THREE.DirectionalLight(BLUE, 0.6);
  rim.position.set(-6, 5, -6);
  scene.add(rim);

  const sweep = new THREE.SpotLight(SKY, 0, 40, Math.PI / 5, 0.7, 1.2);
  sweep.position.set(-8, 6, 6);
  scene.add(sweep);
  scene.add(sweep.target);

  const key = new THREE.PointLight(0xffffff, 0, 14, 1.6);
  key.position.set(0, 2, 4);
  scene.add(key);

  // Destello a pantalla completa pegado a la cámara: tapa el corte entre las
  // terrazas y el logo y se disuelve para dejar ver la V.
  const flashCanvas = document.createElement("canvas");
  flashCanvas.width = 256;
  flashCanvas.height = 256;
  const fctx = flashCanvas.getContext("2d");
  if (fctx) {
    const g = fctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(150,220,255,0.85)");
    g.addColorStop(0.5, "rgba(56,189,248,0.35)");
    g.addColorStop(1, "rgba(37,99,235,0)");
    fctx.fillStyle = g;
    fctx.fillRect(0, 0, 256, 256);
  }
  const flashTexture = new THREE.CanvasTexture(flashCanvas);
  const flashMaterial = new THREE.MeshBasicMaterial({
    map: flashTexture,
    color: 0x8fd3ff,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), flashMaterial);
  flash.position.set(0, 0, -0.6);
  flash.scale.setScalar(0.05);
  flash.renderOrder = 999;
  camera.add(flash);
  scene.add(camera);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.4, 0.55, 0.35);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize(width: number, height: number) {
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // En pantallas verticales se abre el ángulo para que el logo siempre quepa.
    camera.fov = camera.aspect < 1 ? 58 : 38;
    camera.updateProjectionMatrix();
  }

  const lookAt = new THREE.Vector3();

  function renderAt(t: number) {
    const inTerraces = t < INTRO_LOGO_SECONDS;
    terraceGroup.visible = inTerraces;
    logoGroup.visible = !inTerraces;
    dust.visible = true;

    if (inTerraces) {
      // Terrazas: se levantan en cascada.
      for (const terrace of terraces) {
        const delay = 0.55 + terrace.index * 0.07;
        const rise = easeOut((t - delay) / 0.9);
        terrace.mesh.scale.y = Math.max(0.0001, rise);
        terrace.mesh.visible = rise > 0.001;
      }
      terraceGroup.rotation.y = lerp(0.35, -0.2, easeInOut((t - 0.4) / 2.6));

      // Cámara: planea desde la izquierda y se lanza hacia el centro al final.
      const glide = easeInOut((t - 0.4) / 2.4);
      const dive = easeOut((t - 2.6) / 0.6);
      camera.position.set(
        lerp(-5.5, 1.4, glide) * (1 - dive * 0.9),
        lerp(1.4, 2.2, glide) - dive * 0.6,
        lerp(9.5, 5.2, glide) - dive * 5.2
      );
      lookAt.set(lerp(0, 0.4, glide), lerp(1.3, 1.8, glide), 0);
      camera.lookAt(lookAt);

      // Foco celeste que recorre las terrazas de izquierda a derecha.
      const travel = easeInOut((t - 0.5) / 2.2);
      sweep.position.set(lerp(-9, 8, travel), 5.5, 5);
      sweep.target.position.set(lerp(-3, 4, travel), 1.2, 0);
      sweep.intensity = 210 * smooth(0.5, 1.1, t) * (1 - smooth(2.75, 3.1, t) * 0.4);
      key.intensity = 18 * smooth(2.4, 3.0, t);
      rim.intensity = 0.7 * smooth(0.5, 1.5, t);

      bloom.strength = lerp(0.35, 0.5, travel) + smooth(2.7, 3.15, t) * 1.4;
      renderer.toneMappingExposure = 0.9 + smooth(2.8, 3.2, t) * 0.5;
    } else {
      const local = t - INTRO_LOGO_SECONDS;
      const appear = easeOut(local / 0.55);
      const settle = easeInOut(local / 1.8);

      logoGroup.scale.setScalar(lerp(0.78, 1, appear));
      logoGroup.rotation.y = lerp(-0.5, 0.0, easeOut(local / 1.1)) + Math.sin(local * 0.9) * 0.03;
      logoGroup.rotation.x = lerp(0.12, 0, settle);
      logoGroup.position.set(0, 0, 0);

      camera.position.set(lerp(0.4, 0, settle), lerp(0.3, 0.1, settle), lerp(11.4, 9.6, easeOut(local / 1.6)));
      // El logo queda un poco arriba del centro para dejar sitio al nombre debajo.
      lookAt.set(0, -0.55, 0);
      camera.lookAt(lookAt);

      // Reflejo que cruza la V una vez y vuelve a quedar quieta.
      const pass = easeInOut((local - 0.5) / 1.1);
      sweep.position.set(lerp(-7, 7, pass), 3, 5);
      sweep.target.position.set(lerp(-1.5, 1.5, pass), 0, 0);
      sweep.intensity = 120 * smooth(0.3, 0.7, local) * (1 - smooth(1.6, 2.0, local) * 0.7);
      key.intensity = lerp(22, 9, smooth(0, 0.8, local));
      rim.intensity = 1.6;
      vMaterial.emissiveIntensity = 0.12 + (1 - smooth(0, 0.7, local)) * 0.9;

      // El destello decae suave y deja un brillo contenido.
      bloom.strength = lerp(1.6, 0.45, easeOut(local / 0.8));
      renderer.toneMappingExposure = lerp(1.4, 0.95, easeOut(local / 0.6));
    }

    // Destello: sube mientras la cámara se lanza, llega al máximo en el corte y decae.
    const flashIn = smooth(2.95, 3.2, t);
    const flashOut = 1 - smooth(3.2, 3.7, t);
    const flashLevel = Math.min(flashIn, flashOut);
    flashMaterial.opacity = flashLevel * 0.8;
    flash.scale.setScalar(lerp(0.05, 0.32, easeOut((t - 2.95) / 0.9)));
    flash.visible = flashLevel > 0.001;

    dust.rotation.y = t * 0.03;
    dust.position.y = Math.sin(t * 0.5) * 0.08;
    (dust.material as THREE.PointsMaterial).opacity = 0.55 * smooth(0.4, 1.2, t);

    composer.render();
  }

  function dispose() {
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    composer.dispose();
    renderer.dispose();
  }

  resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
  return { renderAt, resize, dispose };
}