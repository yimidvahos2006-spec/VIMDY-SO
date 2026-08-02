import React, { useEffect } from "react";
import { X } from "lucide-react";

type VimdyModalSize = "sm" | "md" | "lg";

interface VimdyModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: VimdyModalSize;
  children: React.ReactNode;
}

const SIZE_CLASS: Record<VimdyModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl"
};

export function VimdyModal({
  open,
  onClose,
  title,
  size = "md",
  children
}: VimdyModalProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className={`
          relative
          w-full
          ${SIZE_CLASS[size]}
          max-h-[85vh]
          overflow-y-auto
          rounded-3xl
          border border-slate-800
          bg-slate-900/95
          backdrop-blur-xl
          shadow-2xl
          p-6
        `}
      >
        {title && (
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold text-white">{title}</h2>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}