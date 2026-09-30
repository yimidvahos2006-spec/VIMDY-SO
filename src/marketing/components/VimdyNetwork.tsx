import { useEffect, useMemo, useRef } from "react";

interface NetworkNode {
  id: string;
  label: string;
  x: number;
  y: number;
  delay: number;
  radius: number;
}

const nodes: NetworkNode[] = [
  { id: "vimdy", label: "VIMDY IA", x: 50, y: 15, delay: 0, radius: 4.5 },
  { id: "caja", label: "CAJA", x: 20, y: 40, delay: 200, radius: 3.5 },
  { id: "cocina", label: "COCINA", x: 80, y: 40, delay: 400, radius: 3.5 },
  { id: "inventario", label: "INVENTARIO", x: 35, y: 70, delay: 600, radius: 3.5 },
  { id: "reportes", label: "REPORTES", x: 65, y: 70, delay: 800, radius: 3.5 },
];

const connections: Array<[string, string]> = [
  ["vimdy", "caja"],
  ["vimdy", "cocina"],
  ["caja", "inventario"],
  ["cocina", "inventario"],
  ["inventario", "reportes"],
];

export function VimdyNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const nodeMap = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!context) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    let reducedMotion = mediaQuery.matches;
    let width = 0;
    let height = 0;
    let startTime = performance.now();
    let lastTimestamp = startTime;
    let visible = !document.hidden;

    const clamp = (value: number, min: number, max: number) =>
      Math.min(max, Math.max(min, value));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);

      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const getPosition = (node: NetworkNode) => ({
      x: (node.x / 100) * width,
      y: (node.y / 100) * height,
    });

    const stopAnimation = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };

    const drawLine = (
      from: { x: number; y: number },
      to: { x: number; y: number },
      elapsed: number,
      delay: number,
    ) => {
      const progress = reducedMotion
        ? 1
        : clamp((elapsed - delay) / 900, 0, 1);

      if (progress <= 0) return;

      const currentX = from.x + (to.x - from.x) * progress;
      const currentY = from.y + (to.y - from.y) * progress;

      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(currentX, currentY);
      context.strokeStyle = `rgba(103, 232, 249, ${0.06 + progress * 0.11})`;
      context.lineWidth = 1;
      context.stroke();

      if (!reducedMotion && progress > 0.08 && progress < 0.98) {
        const glow = 2 + Math.sin(elapsed * 0.004 + delay) * 0.75;

        context.beginPath();
        context.arc(currentX, currentY, glow, 0, Math.PI * 2);
        context.fillStyle = "rgba(103, 232, 249, 0.18)";
        context.fill();
      }
    };

    const drawNode = (node: NetworkNode, elapsed: number) => {
      const position = getPosition(node);
      const progress = reducedMotion
        ? 1
        : clamp((elapsed - node.delay) / 650, 0, 1);

      if (progress <= 0) return;

      const pulse = reducedMotion
        ? 0
        : (Math.sin(elapsed * 0.002 + node.delay) + 1) * 0.5;

      const alpha = 0.24 + progress * 0.36 + pulse * 0.08;

      context.beginPath();
      context.arc(
        position.x,
        position.y,
        node.radius + 9 + pulse * 4,
        0,
        Math.PI * 2,
      );
      context.fillStyle = `rgba(56, 189, 248, ${0.025 + pulse * 0.02})`;
      context.fill();

      context.beginPath();
      context.arc(position.x, position.y, node.radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(125, 211, 252, ${alpha})`;
      context.fill();

      context.font = "600 10px Inter, ui-sans-serif, system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillStyle = `rgba(244, 244, 245, ${0.42 + progress * 0.38})`;
      context.fillText(node.label, position.x, position.y - 10);
    };

    const drawFrame = (timestamp: number) => {
      const elapsed = timestamp - startTime;
      const delta = timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      if (delta > 500) {
        startTime = timestamp;
      }

      context.clearRect(0, 0, width, height);

      for (const [fromId, toId] of connections) {
        const from = nodeMap.get(fromId);
        const to = nodeMap.get(toId);

        if (!from || !to) continue;

        drawLine(
          getPosition(from),
          getPosition(to),
          elapsed,
          Math.max(from.delay, to.delay),
        );
      }

      for (const node of nodes) {
        drawNode(node, elapsed);
      }
    };

    const animate = (timestamp: number) => {
      if (!visible) {
        frameRef.current = null;
        return;
      }

      drawFrame(timestamp);
      frameRef.current = requestAnimationFrame(animate);
    };

    const startAnimation = () => {
      stopAnimation();
      startTime = performance.now();
      lastTimestamp = startTime;
      drawFrame(startTime);

      if (!reducedMotion && visible) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    const handleMotionPreference = () => {
      reducedMotion = mediaQuery.matches;
      startAnimation();
    };

    const handleVisibility = () => {
      visible = !document.hidden;

      if (visible) {
        startAnimation();
      } else {
        stopAnimation();
      }
    };

    resizeObserverRef.current = new ResizeObserver(resize);
    resizeObserverRef.current.observe(canvas);
    mediaQuery.addEventListener("change", handleMotionPreference);
    document.addEventListener("visibilitychange", handleVisibility);

    resize();
    startAnimation();

    return () => {
      stopAnimation();
      resizeObserverRef.current?.disconnect();
      mediaQuery.removeEventListener("change", handleMotionPreference);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [nodeMap]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
      role="presentation"
    />
  );
}