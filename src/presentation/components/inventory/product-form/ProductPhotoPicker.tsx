// src/presentation/components/inventory/product-form/ProductPhotoPicker.tsx
//
// Foto opcional del plato: un cuadro compacto junto al nombre. Un toque abre
// la cámara/galería del celular; la imagen se reduce y comprime antes de guardarse.

import React, { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { fileToProductImage, PRODUCT_CARD_IMAGE } from "../../../utils/imageUtils";

interface Props {
  /** dataURL de la foto actual. "" = sin foto. */
  value: string;
  onChange: (image: string) => void;
  /** Mensaje de error ya listo para mostrar (o null al limpiarlo). */
  onError: (message: string | null) => void;
  disabled?: boolean;
}

export function ProductPhotoPicker({ value, onChange, onError, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (!file) return;
    onError(null);
    setProcessing(true);
    try {
      onChange(await fileToProductImage(file, PRODUCT_CARD_IMAGE));
    } catch (err: any) {
      onError(err?.message ?? "No se pudo procesar la imagen.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || processing}
        aria-label={value ? "Cambiar foto del plato" : "Agregar foto del plato (opcional)"}
        title={value ? "Cambiar foto" : "Agregar foto (opcional)"}
        className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-vimdy-sm border border-dashed border-vimdy-border bg-vimdy-surface text-vimdy-text-tertiary transition-colors duration-vimdy-fast hover:border-vimdy-accent hover:text-vimdy-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {value ? (
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <Camera size={18} aria-hidden="true" className={processing ? "animate-pulse" : ""} />
        )}
      </button>

      {value && !processing && (
        <button
          type="button"
          onClick={() => {
            onError(null);
            onChange("");
          }}
          disabled={disabled}
          aria-label="Quitar foto"
          className="absolute -right-vimdy-xs -top-vimdy-xs flex h-5 w-5 items-center justify-center rounded-full border border-vimdy-border bg-vimdy-background-secondary text-vimdy-text-secondary hover:text-vimdy-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent/40"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}

      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} tabIndex={-1} aria-hidden="true" />
    </div>
  );
}