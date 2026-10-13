import { useState, useEffect } from "react";
import { VimdyButton } from "../ui/VimdyButton";
import { X } from "lucide-react";

export function NewSupplierModal({
  open,
  onClose,
  onCreate,
  creating
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
  }) => Promise<void>;
  creating: boolean;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setPhone("");
      setEmail("");
      setAddress("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-vimdy-border bg-vimdy-surface shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-vimdy-border">
          <h3 className="text-vimdy-text font-bold text-lg">Nuevo proveedor</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-vimdy-text-secondary hover:bg-vimdy-background hover:text-vimdy-text transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Nombre *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Distribuidora ABC"
              className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
            />
          </div>

          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Teléfono</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej: 3001234567"
              className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
            />
          </div>

          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ej: ventas@distribuidora.com"
              className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
            />
          </div>

          <div>
            <label className="block text-vimdy-text-secondary text-sm font-medium mb-1">Dirección</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ej: Calle 10 # 15-20"
              className="w-full h-11 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-vimdy-border">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-xl border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text hover:bg-vimdy-background transition text-sm font-medium"
          >
            Cancelar
          </button>
          <VimdyButton
            onClick={async () => {
              setError(null);
              const trimmedName = name.trim();
              if (!trimmedName) {
                setError("Escribe el nombre del proveedor.");
                return;
              }

              await onCreate({
                name: trimmedName,
                phone: phone.trim() || undefined,
                email: email.trim() || undefined,
                address: address.trim() || undefined
              });
            }}
            disabled={creating}
            className="h-10 px-4"
          >
            {creating ? "Guardando..." : "Guardar proveedor"}
          </VimdyButton>
        </div>
      </div>
    </div>
  );
}