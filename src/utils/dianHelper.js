// src/utils/dianHelper.js

// Cálculo preciso de INC (8% Impoconsumo para restaurantes)
export const calculateINC = (subtotal) => {
  const inc = Number((subtotal * 0.08).toFixed(2));
  return Number(inc.toFixed(2));
};

// Cálculo de totales con descuento opcional
export const calculateTotal = (subtotal, inc, discount = 0) => {
  return Number((subtotal + inc - discount).toFixed(2));
};

export const calculateDianTotals = (items, taxType = 'INC') => {
  let subtotal = 0;
  items.forEach(item => {
    subtotal += item.price * item.quantity;
  });
  
  const subtotalRounded = Number(subtotal.toFixed(2));
  const inc = taxType === 'INC' ? calculateINC(subtotalRounded) : Number((subtotalRounded * 0.19).toFixed(2));
  const total = calculateTotal(subtotalRounded, inc);

  return {
    subtotal: subtotalRounded,
    taxName: taxType === 'INC' ? 'INC (8%)' : 'IVA (19%)',
    tax: inc,
    total: total
  };
};

export const getDianHeaderMock = () => {
  return {
    nit: "900.123.456-1",
    razonSocial: "VIMDY RESTAURANTE S.A.S.",
    resolucionText: "Autorización Facturación POS No. 18764000000000",
    prefijo: "VIM",
    rango: "Del 1 al 10,000",
    vigenciaMeses: 12
  };
};