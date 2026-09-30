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
          <label htmlFor={id} className="text-vimdy-small text-vimdy-text-secondary font-medium">
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
          className={`w-full rounded-vimdy-sm border border-vimdy-border bg-vimdy-background px-4 py-3 pr-11 text-vimdy-body text-vimdy-text placeholder-vimdy-text-tertiary outline-none transition-colors duration-vimdy-fast focus:border-vimdy-accent focus:shadow-vimdy-accent disabled:opacity-50 ${inputClassName}`}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          disabled={disabled}
          aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={showPassword}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-vimdy-text-tertiary transition-colors hover:text-vimdy-accent-hover disabled:opacity-50"
        >
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
