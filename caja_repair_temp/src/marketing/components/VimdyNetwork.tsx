import { useEffect, useRef } from "react";

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  delay: number;
}

const nodes: Node[] = [
  { id: "vimdy", label: "VIMDY IA", x: 50, y: 15, delay: 0 },
  { id: "caja", label: "CAJA", x: 20, y: 40, delay: 200 },
  { id: "cocina", label: "COCINA", x: 80, y: 40, delay: 400 },
  { id: "inventario", label: "INVENTARIO", x: 35, y: 70, delay: 600 },
  { id: "reportes", label: "REPORTES", x: 65, y: 70, delay: 800 },
];

const connections = [
  ["vimdy", "caja"],
  ["vimdy", "cocina"],
  ["caja", "inventario"],
  ["cocina", "inventario"],
  ["inventario", "reportes"],
];

export function VimdyNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    // @ts-ignore
    canvas.width = rect.width * dpr;
    // @ts-ignore
    canvas.height = rect.height * dpr;
    // @ts-ignore
    ctx.scale(dpr, dpr);

    startTimeRef.current = performance.now();

    function getNodePosition(node: Node, width: number, height: number) {
      return {
        x: (node.x / 100) * width,
        y: (node.y / 100) * height,
      };
    }

    function animate(timestamp: number) {
      const elapsed = timestamp - startTimeRef.current;
      // @ts-ignore
      const width = rect.width;
      // @ts-ignore
      const height = rect.height;

      // @ts-ignore
      ctx.clearRect(0, 0, width, height);

      for (const [fromId, toId] of connections) {
        const from = nodes.find((n) => n.id === fromId)!;
        const to = nodes.find((n) => n.id === toId)!;
        const fromPos = getNodePosition(from, width, height);
        const toPos = getNodePosition(to, width, height);

        const lineProgress = Math.min(1, Math.max(0, (elapsed - to.delay) / 800));
        if (lineProgress <= 0) continue;

        const currentX = fromPos.x + (toPos.x - fromPos.x) * lineProgress;
        const currentY = fromPos.y + (toPos.y - fromPos.y) * lineProgress;

        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.lineTo(currentX, currentY);
        // @ts-ignore
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.08 * lineProgress})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (const node of nodes) {
        const pos = getNodePosition(node, width, height);
        const nodeProgress = Math.min(1, Math.max(0, (elapsed - node.delay) / 600));
        if (nodeProgress <= 0) continue;

        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.002 + node.delay);
        const baseAlpha = 0.15 + nodeProgress * 0.25;
        const alpha = baseAlpha + pulse * 0.1;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
        // @ts-ignore
        ctx.fillStyle = `rgba(56, 189, 248, ${alpha})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
        // @ts-ignore
        ctx.fillStyle = `rgba(56, 189, 248, ${alpha * 0.25})`;
        ctx.fill();

        // @ts-ignore
        ctx.font = "10px Inter, system-ui, sans-serif";
        // @ts-ignore
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
        ctx.textAlign = "center";
        // @ts-ignore
        ctx.fillText(node.label, pos.x, pos.y - 12);
      }

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);

    return () => {};
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0, opacity: 0.8 }}
      aria-hidden="true"
    />
  );
}
