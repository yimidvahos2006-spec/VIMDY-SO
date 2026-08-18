import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  label?: string;
  className?: string;
  inputClassName?: string;
}

export function PasswordField({
  id,
  value,
  onChange,
  placeholder = "••••••••",
  disabled = false,
  autoComplete = "current-password",
  label,
  className = "",
  inputClassName = ""
}: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {label && (
        <label htmlFor={id} className="text-sm text-slate-300">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 pr-11 text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400 disabled:opacity-50 ${inputClassName}`}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          disabled={disabled}
          aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={showPassword}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-cyan-400 disabled:opacity-50"
        >
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
