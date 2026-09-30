import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface FormSectionCardProps {
  icon: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function FormSectionCard({
  icon,
  title,
  subtitle,
  defaultOpen = false,
  children,
}: FormSectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-vimdy-border rounded-vimdy-lg bg-vimdy-surface/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-vimdy-surface/30 transition-colors"
      >
        <span className="text-lg">{icon}</span>
        <div className="flex-1">
          <span className="font-medium text-vimdy-text">{title}</span>
          {subtitle && <p className="text-xs text-vimdy-text-tertiary">{subtitle}</p>}
        </div>
        <ChevronDown className={`h-4 w-4 text-vimdy-text-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="p-4 border-t border-vimdy-border">{children}</div>}
    </div>
  );
}
