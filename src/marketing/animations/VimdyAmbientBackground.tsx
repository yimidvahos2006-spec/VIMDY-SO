import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  phase: number;
  phaseSpeed: number;
  targetX: number;
  targetY: number;
}

interface LightOrb {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  opacity: number;
}

interface Point {
  x: number;
  y: number;
}

interface LiveTimingConfig {
  cycleMs: number;
  formMs: number;
  holdMs: number;
  dissolveMs: number;
}

interface VimdyAmbientBackgroundProps {
  className?: string;
  /**
   * "ambient" preserves the lightweight application background.
   * "live" enables the marketing experience with particle-forming icons.
   */
  variant?: "ambient" | "live";
  /**
   * Timing configuration for the "live" variant.
   * When omitted, the default marketing timings are used.
   */
  liveTiming?: Partial<LiveTimingConfig>;
}

const MOBILE_BREAKPOINT = 768;
const MOBILE_FRAME_INTERVAL = 50;
const DESKTOP_FRAME_INTERVAL = 33;
const MAX_DPR_DESKTOP = 1.75;
const MAX_DPR_MOBILE = 1.35;
const PARTICLE_LINK_DISTANCE = 82;
const PARTICLE_LINK_DISTANCE_SQUARED = PARTICLE_LINK_DISTANCE ** 2;

const LIVE_SHAPES = [
  "v",
  "plate",
  "coffee",
  "cutlery",
  "receipt",
  "storefront",
  "boxes",
  "table",
] as const;

type LiveShape = (typeof LIVE_SHAPES)[number];

const DEFAULT_LIVE_TIMING: LiveTimingConfig = {
  cycleMs: 4500,
  formMs: 1000,
  holdMs: 2000,
  dissolveMs: 1000,
};

function smoothStep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function seededRandom(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function buildShapePoints(shape: LiveShape, width: number, height: number): Point[] {
  const isMobile = width < MOBILE_BREAKPOINT;
  const canvas = document.createElement("canvas");
  const sampleWidth = 360;
  const sampleHeight = 240;
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;

  const context = canvas.getContext("2d");
  if (!context) return [];

  context.clearRect(0, 0, sampleWidth, sampleHeight);
  context.strokeStyle = "rgba(255,255,255,1)";
  context.fillStyle = "rgba(255,255,255,1)";
  context.lineWidth = 7;
  context.lineCap = "round";
  context.lineJoin = "round";

  switch (shape) {
    case "v": {
      // Exact V geometry used by the official VimdyLogo component.
      context.beginPath();
      context.moveTo(112, 66);
      context.lineTo(180, 188);
      context.lineTo(248, 66);
      context.stroke();
      break;
    }
    case "plate": {
      context.beginPath();
      context.ellipse(180, 120, 82, 58, 0, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.ellipse(180, 120, 56, 38, 0, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(98, 120);
      context.lineTo(70, 120);
      context.moveTo(262, 120);
      context.lineTo(290, 120);
      context.stroke();
      break;
    }
    case "coffee": {
      context.beginPath();
      context.roundRect(108, 76, 126, 92, 22);
      context.stroke();
      context.beginPath();
      context.arc(242, 122, 29, -Math.PI / 2, Math.PI / 2);
      context.stroke();
      context.beginPath();
      context.moveTo(122, 176);
      context.quadraticCurveTo(180, 194, 236, 176);
      context.stroke();
      context.beginPath();
      context.moveTo(146, 56);
      context.quadraticCurveTo(136, 42, 148, 30);
      context.moveTo(178, 56);
      context.quadraticCurveTo(168, 42, 180, 30);
      context.stroke();
      break;
    }
    case "cutlery": {
      context.beginPath();
      context.moveTo(104, 58);
      context.lineTo(104, 128);
      context.moveTo(114, 58);
      context.lineTo(114, 128);
      context.moveTo(124, 58);
      context.lineTo(124, 128);
      context.moveTo(114, 128);
      context.lineTo(114, 188);
      context.stroke();
      context.beginPath();
      context.moveTo(238, 58);
      context.lineTo(214, 106);
      context.lineTo(214, 188);
      context.moveTo(238, 58);
      context.lineTo(238, 188);
      context.stroke();
      break;
    }
    case "receipt": {
      context.beginPath();
      context.moveTo(110, 48);
      context.lineTo(250, 48);
      context.lineTo(250, 190);
      context.lineTo(232, 178);
      context.lineTo(214, 190);
      context.lineTo(196, 178);
      context.lineTo(178, 190);
      context.lineTo(160, 178);
      context.lineTo(142, 190);
      context.lineTo(110, 172);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.moveTo(136, 84);
      context.lineTo(224, 84);
      context.moveTo(136, 110);
      context.lineTo(218, 110);
      context.moveTo(136, 136);
      context.lineTo(206, 136);
      context.stroke();
      break;
    }
    case "storefront": {
      context.beginPath();
      context.moveTo(88, 92);
      context.lineTo(272, 92);
      context.lineTo(250, 64);
      context.lineTo(110, 64);
      context.closePath();
      context.stroke();
      context.beginPath();
      for (let x = 104; x <= 256; x += 30) {
        context.moveTo(x, 92);
        context.lineTo(x + 10, 112);
      }
      context.moveTo(100, 112);
      context.lineTo(260, 112);
      context.moveTo(118, 112);
      context.lineTo(118, 188);
      context.lineTo(242, 188);
      context.lineTo(242, 112);
      context.stroke();
      context.beginPath();
      context.moveTo(156, 188);
      context.lineTo(156, 142);
      context.lineTo(204, 142);
      context.lineTo(204, 188);
      context.stroke();
      break;
    }
    case "boxes": {
      context.strokeRect(86, 118, 76, 62);
      context.strokeRect(150, 88, 76, 92);
      context.strokeRect(214, 126, 62, 54);
      context.beginPath();
      context.moveTo(86, 118);
      context.lineTo(124, 138);
      context.lineTo(162, 118);
      context.moveTo(150, 88);
      context.lineTo(188, 110);
      context.lineTo(226, 88);
      context.moveTo(214, 126);
      context.lineTo(245, 144);
      context.lineTo(276, 126);
      context.stroke();
      break;
    }
    case "table": {
      context.beginPath();
      context.ellipse(180, 112, 76, 38, 0, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(180, 150);
      context.lineTo(180, 188);
      context.moveTo(152, 188);
      context.lineTo(208, 188);
      context.moveTo(112, 104);
      context.lineTo(84, 104);
      context.lineTo(84, 168);
      context.lineTo(112, 168);
      context.moveTo(248, 104);
      context.lineTo(276, 104);
      context.lineTo(276, 168);
      context.lineTo(248, 168);
      context.stroke();
      break;
    }
  }

  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const rawPoints: Point[] = [];
  const stride = isMobile ? 3 : 2;

  for (let y = 0; y < sampleHeight; y += stride) {
    for (let x = 0; x < sampleWidth; x += stride) {
      if (pixels[(y * sampleWidth + x) * 4 + 3] < 80) continue;
      rawPoints.push({
        x: x / sampleWidth,
        y: y / sampleHeight,
      });
    }
  }

  const centerX = isMobile ? 0.5 : 0.52;
  const centerY = 0.46;
  const scale = isMobile ? 0.42 : 0.4;
  const shapeWidth = Math.min(width, height) * scale;
  const shapeHeight = shapeWidth * (sampleHeight / sampleWidth);

  return rawPoints.map((point) => ({
    x: width * centerX + (point.x - 0.5) * shapeWidth,
    y: height * centerY + (point.y - 0.5) * shapeHeight,
  }));
}

function distributeTargets(points: Point[], count: number, seed: number): Point[] {
  if (points.length === 0) return [];

  return Array.from({ length: count }, (_, index) => {
    const source = points[index % points.length];
    const jitter = points.length > 1 ? (seededRandom(index, seed) - 0.5) * 1.8 : 0;
    return {
      x: source.x + jitter,
      y: source.y + jitter,
    };
  });
}

export function VimdyAmbientBackground({
  className = "",
  variant = "ambient",
  liveTiming,
}: VimdyAmbientBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!ctx) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileQuery = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT}px)`,
    );

    const timing: LiveTimingConfig = {
      cycleMs: liveTiming?.cycleMs ?? DEFAULT_LIVE_TIMING.cycleMs,
      formMs: liveTiming?.formMs ?? DEFAULT_LIVE_TIMING.formMs,
      holdMs: liveTiming?.holdMs ?? DEFAULT_LIVE_TIMING.holdMs,
      dissolveMs: liveTiming?.dissolveMs ?? DEFAULT_LIVE_TIMING.dissolveMs,
    };
    const { cycleMs, formMs, holdMs, dissolveMs } = timing;

    let reducedMotion = motionQuery.matches;
    let isMobile = mobileQuery.matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frameHandle: number | null = null;
    let lastFrameTime = 0;
    let running = true;
    let pointerX = 0.5;
    let pointerY = 0.5;

    const particles: Particle[] = [];
    const orbs: LightOrb[] = [];
    const shapePointCache = new Map<LiveShape, Point[]>();

    const particleCount = () => {
      if (variant === "live") {
        if (reducedMotion) return isMobile ? 80 : 180;
        return isMobile ? 220 : 600;
      }

      if (reducedMotion) return isMobile ? 12 : 20;
      return isMobile ? 28 : 56;
    };

    const rebuildScene = () => {
      particles.length = 0;
      orbs.length = 0;
      shapePointCache.clear();

      const count = particleCount();

      for (let index = 0; index < count; index += 1) {
        const spread = variant === "live" ? 1.05 : 1;
        const x = Math.random() * width * spread;
        const y = Math.random() * height * spread;

        particles.push({
          x,
          y,
          vx:
            variant === "live"
              ? (Math.random() - 0.5) * 0.18
              : (Math.random() - 0.5) * 0.14,
          vy:
            variant === "live"
              ? (Math.random() - 0.5) * 0.18
              : (Math.random() - 0.5) * 0.14,
        size:
            variant === "live"
              ? Math.random() * 1.6 + 0.5
              : Math.random() * 1.3 + 0.3,
        opacity:
            variant === "live"
              ? Math.random() * 0.28 + 0.08
              : Math.random() * 0.25 + 0.06,
          phase: Math.random() * Math.PI * 2,
          phaseSpeed: Math.random() * 0.0017 + 0.0007,
          targetX: x,
          targetY: y,
        });
      }

      const base = Math.min(width, height);

      orbs.push(
        {
          x: width * 0.18,
          y: height * 0.24,
          radius: base * (isMobile ? 0.42 : 0.52),
          vx: 0.025,
          vy: 0.018,
          opacity: variant === "live" ? 0.052 : 0.062,
        },
        {
          x: width * 0.82,
          y: height * 0.7,
          radius: base * (isMobile ? 0.35 : 0.43),
          vx: -0.022,
          vy: -0.015,
          opacity: variant === "live" ? 0.04 : 0.048,
        },
      );

      if (variant === "live") {
        for (const shape of LIVE_SHAPES) {
          shapePointCache.set(shape, buildShapePoints(shape, width, height));
        }
      }
    };

    const resize = () => {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      dpr = Math.min(
        window.devicePixelRatio || 1,
        isMobile ? MAX_DPR_MOBILE : MAX_DPR_DESKTOP,
      );

      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = "100vw";
      canvas.style.height = "100vh";

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      rebuildScene();
    };

    const drawBase = () => {
      const background = ctx.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, "rgba(3, 6, 10, 0.985)");
      background.addColorStop(0.48, "rgba(3, 7, 11, 0.965)");
      background.addColorStop(1, "rgba(2, 4, 7, 0.995)");

      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    };

    const drawOrbs = (time: number) => {
      orbs.forEach((orb, index) => {
        if (!reducedMotion) {
          orb.x += orb.vx;
          orb.y += orb.vy;

          if (orb.x < -orb.radius || orb.x > width + orb.radius) {
            orb.vx *= -1;
          }

          if (orb.y < -orb.radius || orb.y > height + orb.radius) {
            orb.vy *= -1;
          }
        }

        const breath = reducedMotion
          ? 1
          : 1 + Math.sin(time * 0.00045 + index * 1.6) * 0.08;
        const radius = orb.radius * breath;

        const gradient = ctx.createRadialGradient(
          orb.x,
          orb.y,
          0,
          orb.x,
          orb.y,
          radius,
        );
        gradient.addColorStop(0, `rgba(34, 211, 238, ${orb.opacity * 0.8})`);
        gradient.addColorStop(
          0.42,
          `rgba(59, 130, 246, ${orb.opacity * 0.35})`,
        );
        gradient.addColorStop(1, "rgba(37, 99, 235, 0)");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(orb.x, orb.y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    const getLiveShapeState = (time: number) => {
      const cycleTime = time % cycleMs;
      const cycleIndex = Math.floor(time / cycleMs);
      const shapeIndex = cycleIndex % LIVE_SHAPES.length;
      const shape = LIVE_SHAPES[shapeIndex];

      if (cycleTime < formMs) {
        return {
          shape,
          progress: smoothStep(cycleTime / formMs),
        };
      }

      if (cycleTime < formMs + holdMs) {
        return { shape, progress: 1 };
      }

      if (cycleTime < formMs + holdMs + dissolveMs) {
        const dissolveTime = cycleTime - formMs - holdMs;
        return {
          shape,
          progress: 1 - smoothStep(dissolveTime / dissolveMs),
        };
      }

      return { shape, progress: 0 };
    };

    const drawLiveParticles = (time: number) => {
      const { shape, progress } = getLiveShapeState(time);
      const points = shapePointCache.get(shape) ?? [];
      const targets = distributeTargets(points, particles.length, shape.length);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const target = targets[index];

        if (!reducedMotion) {
          particle.x += particle.vx;
          particle.y += particle.vy;
          particle.phase += particle.phaseSpeed * 16;

          if (particle.x < -16) particle.x = width + 16;
          if (particle.x > width + 16) particle.x = -16;
          if (particle.y < -16) particle.y = height + 16;
          if (particle.y > height + 16) particle.y = -16;
        }

        if (target && progress > 0) {
          const attractStrength = 0.035 + progress * 0.085;
          particle.x += (target.x - particle.x) * attractStrength;
          particle.y += (target.y - particle.y) * attractStrength;
        }

        const parallaxStrength = variant === "live" ? 8 : 2;
        const parallaxX = (pointerX - 0.5) * parallaxStrength;
        const parallaxY = (pointerY - 0.5) * parallaxStrength;
        const pulse = reducedMotion
          ? 0.78
          : 0.68 + 0.32 * ((Math.sin(particle.phase) + 1) / 2);

        const shapeAlpha = progress > 0 ? 1 + progress * 0.5 : 1;
        const alpha = particle.opacity * pulse * shapeAlpha;
        const drawX = particle.x + parallaxX;
        const drawY = particle.y + parallaxY;

        ctx.beginPath();
        ctx.arc(drawX, drawY, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(103, 232, 249, ${alpha})`;
        ctx.fill();
      }

      if (!reducedMotion) {
        const focalX = isMobile ? width * 0.5 : width * 0.52;
        const focalY = height * 0.46;
        const focalRadius = Math.min(width, height) * (isMobile ? 0.35 : 0.28);
        const glowAlpha = progress * 0.06;

        if (glowAlpha > 0) {
          const gradient = ctx.createRadialGradient(
            focalX,
            focalY,
            0,
            focalX,
            focalY,
            focalRadius,
          );
          gradient.addColorStop(0, `rgba(56, 189, 248, ${glowAlpha})`);
          gradient.addColorStop(1, "rgba(56, 189, 248, 0)");
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, width, height);
        }
      }
    };

    const drawAmbientParticles = (time: number) => {
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];

        if (!reducedMotion) {
          particle.x += particle.vx;
          particle.y += particle.vy;
          particle.phase += particle.phaseSpeed * 16;

          if (particle.x < -10) particle.x = width + 10;
          if (particle.x > width + 10) particle.x = -10;
          if (particle.y < -10) particle.y = height + 10;
          if (particle.y > height + 10) particle.y = -10;
        }

        const pulse = reducedMotion
          ? 0.82
          : 0.68 + 0.32 * ((Math.sin(particle.phase) + 1) / 2);

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(103, 232, 249, ${particle.opacity * pulse})`;
        ctx.fill();

        if (isMobile) continue;

        for (
          let otherIndex = index + 1;
          otherIndex < particles.length;
          otherIndex += 1
        ) {
          const other = particles[otherIndex];
          const dx = particle.x - other.x;
          const dy = particle.y - other.y;
          const distanceSquared = dx * dx + dy * dy;

          if (distanceSquared > PARTICLE_LINK_DISTANCE_SQUARED) continue;

          const distance = Math.sqrt(distanceSquared);
          const alpha = (1 - distance / PARTICLE_LINK_DISTANCE) * 0.03;

          ctx.beginPath();
          ctx.moveTo(particle.x, particle.y);
          ctx.lineTo(other.x, other.y);
          ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`;
          ctx.lineWidth = 0.45;
          ctx.stroke();
        }
      }

      if (!reducedMotion && !isMobile) {
        const centerX = width * 0.5;
        const centerY = height * (0.34 + Math.sin(time * 0.00018) * 0.018);
        const radius = Math.min(width, height) * 0.34;
        const glow = ctx.createRadialGradient(
          centerX,
          centerY,
          0,
          centerX,
          centerY,
          radius,
        );

        glow.addColorStop(0, "rgba(56, 189, 248, 0.022)");
        glow.addColorStop(1, "rgba(56, 189, 248, 0)");

        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
      }
    };

    const render = (time: number) => {
      if (!running) return;

      const frameInterval = isMobile
        ? MOBILE_FRAME_INTERVAL
        : DESKTOP_FRAME_INTERVAL;

      if (time - lastFrameTime < frameInterval) {
        frameHandle = window.requestAnimationFrame(render);
        return;
      }

      lastFrameTime = time;
      drawBase();
      drawOrbs(time);

      if (variant === "live") {
        drawLiveParticles(time);
      } else {
        drawAmbientParticles(time);
      }

      frameHandle = window.requestAnimationFrame(render);
    };

    const restart = () => {
      if (!running) return;

      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
      }

      lastFrameTime = 0;
      frameHandle = window.requestAnimationFrame(render);
    };

    const handleMotionChange = () => {
      reducedMotion = motionQuery.matches;
      rebuildScene();
      restart();
    };

    const handleMobileChange = () => {
      isMobile = mobileQuery.matches;
      resize();
      restart();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (isMobile || reducedMotion) return;

      pointerX = event.clientX / Math.max(1, window.innerWidth);
      pointerY = event.clientY / Math.max(1, window.innerHeight);
    };

    const handlePointerLeave = () => {
      pointerX = 0.5;
      pointerY = 0.5;
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        running = false;

        if (frameHandle !== null) {
          window.cancelAnimationFrame(frameHandle);
          frameHandle = null;
        }

        return;
      }

      running = true;
      lastFrameTime = 0;
      frameHandle = window.requestAnimationFrame(render);
    };

    resize();

    if (reducedMotion) {
      drawBase();
      drawOrbs(0);
      if (variant === "live") {
        const previous = reducedMotion;
        reducedMotion = true;
        drawLiveParticles(formMs + holdMs / 2);
        reducedMotion = previous;
      } else {
        drawAmbientParticles(0);
      }
    } else {
      frameHandle = window.requestAnimationFrame(render);
    }

    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave, { passive: true });
    motionQuery.addEventListener("change", handleMotionChange);
    mobileQuery.addEventListener("change", handleMobileChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      running = false;

      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
      }

      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      motionQuery.removeEventListener("change", handleMotionChange);
      mobileQuery.removeEventListener("change", handleMobileChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [variant, liveTiming]);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none fixed inset-0 h-full w-full ${className}`}
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
}
