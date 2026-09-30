import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  pulse: number;
  pulseSpeed: number;
}

interface LightOrb {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  opacity: number;
}

export function VimdyAmbientBackground({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const orbsRef = useRef<LightOrb[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const isMobile = window.matchMedia("(max-width: 768px)").matches;

    function resize() {
      // @ts-ignore
      canvas.width = window.innerWidth;
      // @ts-ignore
      canvas.height = window.innerHeight;
    }

    function init() {
      resize();
      // @ts-ignore
      particlesRef.current = Array.from({ length: isMobile ? 40 : 80 }, () => ({
        // @ts-ignore
        x: Math.random() * canvas.width,
        // @ts-ignore
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        size: Math.random() * 1.2 + 0.3,
        opacity: Math.random() * 0.35 + 0.05,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: Math.random() * 0.015 + 0.005,
      }));

      // @ts-ignore
      orbsRef.current = [
        {
          // @ts-ignore
          x: canvas.width * 0.2,
          // @ts-ignore
          y: canvas.height * 0.3,
          // @ts-ignore
          radius: Math.min(canvas.width, canvas.height) * 0.45,
          vx: 0.18,
          vy: 0.12,
          opacity: 0.14,
        },
        {
          // @ts-ignore
          x: canvas.width * 0.8,
          // @ts-ignore
          y: canvas.height * 0.7,
          // @ts-ignore
          radius: Math.min(canvas.width, canvas.height) * 0.38,
          vx: -0.14,
          vy: -0.09,
          opacity: 0.10,
        },
      ];
    }

    function drawOrbs(time: number) {
      const orbs = orbsRef.current;
      for (let i = 0; i < orbs.length; i++) {
        const orb = orbs[i];
        orb.x += orb.vx;
        orb.y += orb.vy;

        // @ts-ignore
        if (orb.x < -orb.radius || orb.x > canvas.width + orb.radius) orb.vx *= -1;
        // @ts-ignore
        if (orb.y < -orb.radius || orb.y > canvas.height + orb.radius) orb.vy *= -1;

        const breathe = 1 + Math.sin(time * 0.0005 + i) * 0.15;
        // @ts-ignore
        const gradient = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.radius * breathe);
        gradient.addColorStop(0, `rgba(37, 99, 235, ${orb.opacity})`);
        gradient.addColorStop(0.5, `rgba(56, 189, 248, ${orb.opacity * 0.4})`);
        gradient.addColorStop(1, "rgba(37, 99, 235, 0)");

        // @ts-ignore
        ctx.beginPath();
        // @ts-ignore
        ctx.arc(orb.x, orb.y, orb.radius * breathe, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }
    }

    function drawParticles(time: number) {
      const particles = particlesRef.current;
      // @ts-ignore
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.pulse += p.pulseSpeed;
        p.x += p.vx;
        p.y += p.vy;

        // @ts-ignore
        if (p.x < 0) p.x = canvas.width;
        // @ts-ignore
        if (p.x > canvas.width) p.x = 0;
        // @ts-ignore
        if (p.y < 0) p.y = canvas.height;
        // @ts-ignore
        if (p.y > canvas.height) p.y = 0;

        const currentOpacity = p.opacity * (0.7 + 0.3 * Math.sin(p.pulse));
        // @ts-ignore
        ctx.beginPath();
        // @ts-ignore
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        // @ts-ignore
        ctx.fillStyle = `rgba(56, 189, 248, ${currentOpacity})`;
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 100) {
            const alpha = (1 - dist / 100) * 0.06;
            // @ts-ignore
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            // @ts-ignore
            ctx.strokeStyle = `rgba(37, 99, 235, ${alpha})`;
            ctx.lineWidth = 0.4;
            ctx.stroke();
          }
        }
      }
    }

    function animate(time: number) {
      // @ts-ignore
      ctx.fillStyle = "rgba(5, 5, 8, 0.3)";
      // @ts-ignore
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      drawOrbs(time);
      drawParticles(time);

      animationRef.current = requestAnimationFrame(animate);
    }

    init();
    animationRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
      resize();
      init();
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`fixed inset-0 w-full h-full pointer-events-none ${className}`}
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
}
