import type { Receipt } from "../../../../core/engines/ReceiptEngine";
import type { Business } from "../../../../core/store/businessStore";
import type { ReceiptTemplateId } from "../../../../core/store/printSettingsStore";
import type { PrintableReceiptItem, ReceiptRenderExtras } from "../../../utils/receiptTemplateRenderer";

export interface SampleTicket {
  readonly receipt: Receipt;
  readonly items: PrintableReceiptItem[];
  readonly extras: ReceiptRenderExtras;
}

const RESTAURANT_ITEMS: PrintableReceiptItem[] = [
  { name: "Bandeja paisa", quantity: 2, price: 32000 },
  { name: "Limonada de coco", quantity: 2, price: 9500 },
  { name: "Postre tres leches", quantity: 1, price: 12000 }
];

const SAMPLE_ITEMS: Record<ReceiptTemplateId, PrintableReceiptItem[]> = {
  clasico: RESTAURANT_ITEMS,
  moderno: RESTAURANT_ITEMS,
  restaurante: RESTAURANT_ITEMS,
  supermercado: [
    { name: "Arroz 500 g", quantity: 3, price: 3200 },
    { name: "Aceite girasol 1 L", quantity: 1, price: 14900 },
    { name: "Leche entera 1 L", quantity: 4, price: 4300 },
    { name: "Huevos x30", quantity: 1, price: 19800 },
    { name: "Pan tajado", quantity: 2, price: 6900 },
    { name: "Detergente 1 kg", quantity: 1, price: 16500 }
  ],
  cafeteria: [
    { name: "Café americano", quantity: 2, price: 4500 },
    { name: "Croissant de queso", quantity: 2, price: 6500 }
  ]
};

/** Descuento de ejemplo (5%): sin él, el interruptor "Descuentos" no tendría efecto visible. */
const SAMPLE_DISCOUNT_RATE = 0.05;
const SAMPLE_TAX_RATE = 0.19;

/**
 * Venta de ejemplo para la vista previa. Incluye mesa, descuento, propina,
 * cajero y cliente para que CADA interruptor del editor tenga efecto visible.
 * Es una función pura: misma entrada, mismo ticket.
 */
export function buildSampleTicket(business: Business, template: ReceiptTemplateId): SampleTicket {
  const items = SAMPLE_ITEMS[template].map((item) => ({ ...item }));
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const discount = Math.round(subtotal * SAMPLE_DISCOUNT_RATE);
  const tax = Math.round((subtotal - discount) * SAMPLE_TAX_RATE);
  const tip = template === "restaurante" ? Math.round(subtotal * 0.1) : 0;
  const total = subtotal - discount + tax + tip;
  // Billete redondo por encima del total, como en una caja real.
  const received = Math.ceil(total / 10000) * 10000;

  const receipt: Receipt = {
    id: "preview",
    code: "A-000124",
    customerId: "preview",
    customerName: "Juan Pérez",
    cashier: "Carlos",
    paymentMethod: "Efectivo",
    items: [],
    currency: business.currency || "COP",
    subtotal,
    tax,
    discount,
    tip,
    total,
    received,
    change: received - total,
    createdAt: new Date(2026, 10, 1, 13, 45)
  };

  return { receipt, items, extras: { tableName: "Mesa 7" } };
}

/** Interruptores que se activan pero no tendrían efecto porque falta el dato en el negocio. */
export type ToggleNotes = Partial<
  Record<"showLogo" | "showQr" | "showAddress" | "showPhone" | "showEmail", string>
>;

/**
 * Avisos para el administrador: "activaste X pero no hay nada que mostrar".
 * Sin esto, un interruptor sin efecto en la vista previa parece un error del editor.
 */
export function toggleAvailabilityNotes(business: Business): ToggleNotes {
  const notes: ToggleNotes = {};
  if (!business.logo?.trim()) notes.showLogo = "El negocio aún no tiene logo. Súbelo en Datos del negocio.";
  if (!business.address?.trim()) notes.showAddress = "Falta la dirección en Datos del negocio.";
  if (!business.phone?.trim()) notes.showPhone = "Falta el teléfono en Datos del negocio.";
  if (!business.email?.trim()) notes.showEmail = "Falta el correo en Datos del negocio.";
  if (!business.whatsappOrders?.trim() && !business.phone?.trim()) {
    notes.showQr = "El QR necesita el WhatsApp de pedidos o el teléfono del negocio.";
  }
  return notes;
}