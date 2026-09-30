import { useEffect, useRef } from "react";

const PARTICLE_COUNT = 80;
const MOBILE_PARTICLE_COUNT = 30;
const LINE_DISTANCE = 150;
const MOUSE_INFLUENCE = 100;
const MAX_DPR = 2;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
}

interface PointerPosition {
  x: number;
  y: number;
}

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef<PointerPosition>({ x: -1000, y: -1000 });
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!ctx) return;

    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const mobileQuery = window.matchMedia("(max-width: 768px)");

    let reducedMotion = reducedMotionQuery.matches;
    let isMobile = mobileQuery.matches;
    let visible = !document.hidden;
    let width = 1;
    let height = 1;
    let cssWidth = 1;
    let cssHeight = 1;

    const clamp = (value: number, min: number, max: number) =>
      Math.min(max, Math.max(min, value));

    const stopAnimation = () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };

    const resize = () => {
      cssWidth = Math.max(1, window.innerWidth);
      cssHeight = Math.max(1, window.innerHeight);

      const dpr = clamp(window.devicePixelRatio || 1, 1, MAX_DPR);

      width = Math.max(1, Math.round(cssWidth * dpr));
      height = Math.max(1, Math.round(cssHeight * dpr));

      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const initParticles = () => {
      const count = isMobile ? MOBILE_PARTICLE_COUNT : PARTICLE_COUNT;
      particlesRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * cssWidth,
        y: Math.random() * cssHeight,
        vx: (Math.random() - 0.5) * (reducedMotion ? 0 : 0.3),
        vy: (Math.random() - 0.5) * (reducedMotion ? 0 : 0.3),
        size: Math.random() * 1.5 + 0.5,
        opacity: Math.random() * 0.3 + 0.1,
      }));
    };

    const drawFrame = () => {
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      for (let i = 0; i < particles.length; i += 1) {
        const particle = particles[i];

        if (!reducedMotion) {
          particle.x += particle.vx;
          particle.y += particle.vy;

          if (particle.x < 0) particle.x = cssWidth;
          if (particle.x > cssWidth) particle.x = 0;
          if (particle.y < 0) particle.y = cssHeight;
          if (particle.y > cssHeight) particle.y = 0;

          const dx = mouse.x - particle.x;
          const dy = mouse.y - particle.y;
          const distanceSquared = dx * dx + dy * dy;

          if (distanceSquared < MOUSE_INFLUENCE * MOUSE_INFLUENCE) {
            const distance = Math.sqrt(distanceSquared);

            if (distance > 0.001) {
              const force = (MOUSE_INFLUENCE - distance) / MOUSE_INFLUENCE;
              particle.x -= dx * force * 0.02;
              particle.y -= dy * force * 0.02;
            }
          }
        }

        ctx.beginPath();
        ctx.arc(
          particle.x,
          particle.y,
          particle.size,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = `rgba(37, 99, 235, ${particle.opacity})`;
        ctx.fill();

        if (reducedMotion) continue;

        for (let j = i + 1; j < particles.length; j += 1) {
          const other = particles[j];
          const dx = particle.x - other.x;
          const dy = particle.y - other.y;
          const distanceSquared = dx * dx + dy * dy;

          if (distanceSquared >= LINE_DISTANCE * LINE_DISTANCE) continue;

          const distance = Math.sqrt(distanceSquared);
          const alpha = (1 - distance / LINE_DISTANCE) * 0.08;

          ctx.beginPath();
          ctx.moveTo(particle.x, particle.y);
          ctx.lineTo(other.x, other.y);
          ctx.strokeStyle = `rgba(37, 99, 235, ${alpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    };

    const animate = () => {
      if (!visible) {
        animationRef.current = null;
        return;
      }

      drawFrame();
      animationRef.current = requestAnimationFrame(animate);
    };

    const startAnimation = () => {
      stopAnimation();
      drawFrame();

      if (!reducedMotion && visible) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    const handleResize = () => {
      resize();
      initParticles();
      drawFrame();
    };

    const handleMouseMove = (event: MouseEvent) => {
      mouseRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePointerLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;

      mouseRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleVisibility = () => {
      visible = !document.hidden;

      if (visible) {
        startAnimation();
      } else {
        stopAnimation();
      }
    };

    const handleMotionPreference = () => {
      reducedMotion = reducedMotionQuery.matches;
      initParticles();
      startAnimation();
    };

    const handleMobilePreference = () => {
      isMobile = mobileQuery.matches;
      initParticles();
      startAnimation();
    };

    resize();
    initParticles();
    startAnimation();

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("mouseleave", handlePointerLeave);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    reducedMotionQuery.addEventListener("change", handleMotionPreference);
    mobileQuery.addEventListener("change", handleMobilePreference);

    return () => {
      stopAnimation();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handlePointerLeave);
      window.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("visibilitychange", handleVisibility);
      reducedMotionQuery.removeEventListener("change", handleMotionPreference);
      mobileQuery.removeEventListener("change", handleMobilePreference);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      style={{ opacity: 0.6 }}
    />
  );
}
