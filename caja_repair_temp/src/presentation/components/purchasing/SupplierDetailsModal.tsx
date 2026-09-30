import React from "react";
import { Phone, Mail, MapPin, Truck, User } from "lucide-react";

import { VimdyModal } from "../ui/VimdyModal";
import { Supplier } from "../../../core/entities/Entities";

interface SupplierDetailsModalProps {
  open: boolean;
  onClose: () => void;
  supplier: Supplier | null;
}

/** "Ver proveedor" — PASO 2.7: datos de contacto reales del proveedor de un ítem. */
export function SupplierDetailsModal({ open, onClose, supplier }: SupplierDetailsModalProps) {
  if (!supplier) return null;

  const rows: { icon: React.ReactNode; label: string; value: string }[] = [
    ...(supplier.contactName ? [{ icon: <User size={15} />, label: "Contacto", value: supplier.contactName }] : []),
    ...(supplier.phone ? [{ icon: <Phone size={15} />, label: "Teléfono", value: supplier.phone }] : []),
    ...(supplier.email ? [{ icon: <Mail size={15} />, label: "Correo", value: supplier.email }] : []),
    ...(supplier.address ? [{ icon: <MapPin size={15} />, label: "Dirección", value: supplier.address }] : []),
    ...(supplier.avgDeliveryDays !== undefined
      ? [{ icon: <Truck size={15} />, label: "Tiempo de entrega", value: `~${supplier.avgDeliveryDays} día(s)` }]
      : [])
  ];

  return (
    <VimdyModal open={open} onClose={onClose} title={supplier.name} size="sm">
      {rows.length === 0 ? (
        <p className="text-vimdy-text-secondary text-sm">Este proveedor no tiene datos de contacto registrados todavía.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start gap-3 text-sm">
              <span className="text-vimdy-accent mt-0.5">{row.icon}</span>
              <div>
                <p className="text-vimdy-text-tertiary text-xs">{row.label}</p>
                <p className="text-vimdy-text">{row.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </VimdyModal>
  );
}