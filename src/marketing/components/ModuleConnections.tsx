import { useEffect, useRef } from "react";

interface ModuleNode {
  id: string;
  label: string;
  icon: string;
  x: number;
  y: number;
  color: string;
}

const modules: ModuleNode[] = [
  { id: "ventas", label: "Ventas", icon: "🛒", x: 50, y: 20, color: "#38BDF8" },
  { id: "caja", label: "Caja", icon: "💰", x: 20, y: 45, color: "#2563EB" },
  { id: "cocina", label: "Cocina", icon: "👨‍🍳", x: 80, y: 45, color: "#3B82F6" },
  { id: "inventario", label: "Inventario", icon: "📦", x: 35, y: 70, color: "#1D4ED8" },
  { id: "reportes", label: "Reportes", icon: "📊", x: 65, y: 70, color: "#2563EB" },
];

const connections = [
  ["ventas", "caja"],
  ["ventas", "cocina"],
  ["caja", "inventario"],
  ["cocina", "inventario"],
  ["inventario", "reportes"],
];

export function ModuleConnections() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startTimeRef = useRef<number>(0);

   useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // @ts-ignore
    const ctx2 = ctx;
    // @ts-ignore
    const rect2 = rect;

    startTimeRef.current = performance.now();

    function getNodePosition(node: ModuleNode, width: number, height: number) {
      return {
        x: (node.x / 100) * width,
        y: (node.y / 100) * height,
      };
    }

    function animate(timestamp: number) {
      const elapsed = timestamp - startTimeRef.current;
      const width = rect2.width;
      const height = rect2.height;

      ctx2.clearRect(0, 0, width, height);

      for (const [fromId, toId] of connections) {
        const from = modules.find((m) => m.id === fromId)!;
        const to = modules.find((m) => m.id === toId)!;
        const fromPos = getNodePosition(from, width, height);
        const toPos = getNodePosition(to, width, height);

        const progress = Math.min(1, Math.max(0, (elapsed - 1000) / 2000));

        ctx2.beginPath();
        ctx2.moveTo(fromPos.x, fromPos.y);
        ctx2.lineTo(
          fromPos.x + (toPos.x - fromPos.x) * progress,
          fromPos.y + (toPos.y - fromPos.y) * progress
        );
        ctx2.strokeStyle = `rgba(56, 189, 248, ${0.15 * progress})`;
        ctx2.lineWidth = 1;
        ctx2.stroke();

        if (progress >= 1) {
          const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.002 + fromId.length);
          ctx2.beginPath();
          ctx2.arc(toPos.x, toPos.y, 3 + pulse * 2, 0, Math.PI * 2);
          ctx2.fillStyle = `rgba(56, 189, 248, ${0.3 + pulse * 0.2})`;
          ctx2.fill();
        }
      }

      for (const module of modules) {
        const pos = getNodePosition(module, width, height);
        const moduleProgress = Math.min(1, Math.max(0, (elapsed - 500) / 1500));
        if (moduleProgress <= 0) continue;

        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 0.002 + module.id.length);
        const alpha = 0.4 + moduleProgress * 0.4 + pulse * 0.2;

        ctx2.beginPath();
        ctx2.arc(pos.x, pos.y, 20, 0, Math.PI * 2);
        ctx2.fillStyle = `rgba(37, 99, 235, ${alpha * 0.1})`;
        ctx2.fill();

        ctx2.beginPath();
        ctx2.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
        ctx2.fillStyle = module.color;
        ctx2.globalAlpha = alpha;
        ctx2.fill();
        ctx2.globalAlpha = 1;

        ctx2.font = "bold 11px Inter, system-ui, sans-serif";
        ctx2.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx2.textAlign = "center";
        ctx2.fillText(module.label, pos.x, pos.y + 35);
      }

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);

    return () => {};
  }, []);

  return (
    <div className="relative w-full h-[400px] md:h-[500px]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 0, opacity: 0.9 }}
        aria-hidden="true"
      />
      <div className="relative z-10 flex items-center justify-center h-full">
        <div className="text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Todo lo que necesitas para operar
          </h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
            VIMDY reúne las herramientas esenciales de tu negocio en una sola plataforma.
            Los módulos están conectados: ventas alimentan caja e inventario, cocina recibe órdenes en tiempo real,
            y reportes consolidan toda la operación.
          </p>
        </div>
      </div>
    </div>
  );
}
