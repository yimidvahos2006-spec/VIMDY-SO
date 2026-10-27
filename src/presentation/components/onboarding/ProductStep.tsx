import React, { useState } from 'react';

interface ProductStepProps {
  initialValues?: {
    name?: string;
    salePrice?: number;
    costPrice?: number;
    initialStock?: number;
  };
  onSave: (data: { name: string; salePrice: number; costPrice: number; initialStock: number }) => void;
}

// Funciones de utilidad para formatear y limpiar precios (separador de miles con punto)
const formatPrice = (value: string | number): string => {
  if (value === null || value === undefined || value === '') return '';
  const cleanValue = value.toString().replace(/\D/g, '');
  if (!cleanValue) return '';
  return Number(cleanValue).toLocaleString('es-CO');
};

const parsePrice = (value: string): number => {
  const cleanValue = value.replace(/\./g, '');
  return Number(cleanValue) || 0;
};

export function ProductStep({ initialValues, onSave }: ProductStepProps) {
  const [productName, setProductName] = useState(initialValues?.name || '');
  
  // Estados locales para los inputs con formato visual (con puntos de miles)
  const [salePriceDisplay, setSalePriceDisplay] = useState(
    initialValues?.salePrice ? formatPrice(initialValues.salePrice) : '0'
  );
  const [costPriceDisplay, setCostPriceDisplay] = useState(
    initialValues?.costPrice ? formatPrice(initialValues.costPrice) : '0'
  );
  const [stockDisplay, setStockDisplay] = useState(
    initialValues?.initialStock ? formatPrice(initialValues.initialStock) : '0'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: productName,
      salePrice: parsePrice(salePriceDisplay),
      costPrice: parsePrice(costPriceDisplay),
      initialStock: parsePrice(stockDisplay),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 w-full max-w-lg mx-auto p-6 bg-gray-950 text-white rounded-xl border border-gray-800">
      <div>
        <h3 className="text-lg font-semibold">Producto o servicio</h3>
        <p className="text-sm text-gray-400">Completa los datos básicos para comenzar.</p>
      </div>

      {/* Nombre del producto */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-300">Nombre del producto o servicio *</label>
        <input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="Ej: Coca-Cola 350ml"
          required
          className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Precios: Venta y Costo */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Precio de venta *</label>
          <div className="relative flex items-center">
            <span className="absolute left-3 text-gray-400">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={salePriceDisplay}
              onChange={(e) => setSalePriceDisplay(formatPrice(e.target.value))}
              className="w-full pl-8 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Costo (opcional)</label>
          <div className="relative flex items-center">
            <span className="absolute left-3 text-gray-400">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={costPriceDisplay}
              onChange={(e) => setCostPriceDisplay(formatPrice(e.target.value))}
              className="w-full pl-8 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Stock inicial */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-300">Stock inicial</label>
        <input
          type="text"
          inputMode="numeric"
          value={stockDisplay}
          onChange={(e) => setStockDisplay(formatPrice(e.target.value))}
          className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
        />
        <span className="text-xs text-gray-500">Si no ingresas stock, comenzará con 0 unidades.</span>
      </div>

      {/* Botones de acción */}
      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          className="flex-1 py-2.5 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          Crear producto
        </button>
      </div>
    </form>
  );
}