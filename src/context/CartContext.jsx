// src/context/CartContext.jsx
import { createContext, useContext, useEffect, useReducer } from 'react';

const CartContext = createContext(null);

// Reducer completamente inmutable para evitar bugs de renderizado
const cartReducer = (state, action) => {
  switch (action.type) {
    case 'ADD_ITEM': {
      const { product, quantity = 1 } = action.payload;
      const existingIndex = state.items.findIndex(item => item.id === product.id);
      
      if (existingIndex !== -1) {
        const newItems = [...state.items];
        const newQty = newItems[existingIndex].quantity + quantity;
        newItems[existingIndex] = {
          ...newItems[existingIndex],
          quantity: newQty,
          subtotal: Number((newItems[existingIndex].price * newQty).toFixed(2))
        };
        return { ...state, items: newItems };
      }
      
      const newItem = {
        id: product.id,
        name: product.name,
        price: product.price,
        quantity,
        subtotal: Number((product.price * quantity).toFixed(2))
      };
      
      return {
        ...state,
        items: [...state.items, newItem]
      };
    }
    
    case 'REMOVE_ITEM': {
      return {
        ...state,
        items: state.items.filter(item => item.id !== action.payload)
      };
    }
    
    case 'UPDATE_QUANTITY': {
      const { id, quantity } = action.payload;
      if (quantity <= 0) {
        return {
          ...state,
          items: state.items.filter(item => item.id !== id)
        };
      }
      
      return {
        ...state,
        items: state.items.map(item =>
          item.id === id
            ? {
                ...item,
                quantity,
                subtotal: Number((quantity * item.price).toFixed(2))
              }
            : item
        )
      };
    }
    
    case 'CLEAR_CART': {
      return { items: [], total: 0 };
    }
    
    case 'CALCULATE_TOTAL': {
      const total = state.items.reduce(
        (sum, item) => sum + item.subtotal, 
        0
      );
      return { ...state, total: Number(total.toFixed(2)) };
    }
    
    default:
      return state;
  }
};

// Carga segura de localStorage para evitar que un JSON corrupto rompa la app
const loadCartFromStorage = () => {
  try {
    const stored = localStorage.getItem('vimdy_cart');
    if (!stored) return { items: [], total: 0 };
    
    const parsed = JSON.parse(stored);
    if (!parsed.items || !Array.isArray(parsed.items)) {
      return { items: [], total: 0 };
    }
    return parsed;
  } catch (error) {
    console.error('Error cargando carrito de localStorage:', error);
    localStorage.removeItem('vimdy_cart');
    return { items: [], total: 0 };
  }
};

export const CartProvider = ({ children }) => {
  const [state, dispatch] = useReducer(cartReducer, undefined, loadCartFromStorage);
  
  useEffect(() => {
    try {
      localStorage.setItem('vimdy_cart', JSON.stringify(state));
    } catch (error) {
      console.error('Error guardando carrito en localStorage:', error);
    }
  }, [state]);
  
  useEffect(() => {
    dispatch({ type: 'CALCULATE_TOTAL' });
  }, [state.items]);
  
  const addToCart = (product, quantity = 1) => {
    dispatch({ type: 'ADD_ITEM', payload: { product, quantity } });
  };
  
  const removeFromCart = (id) => {
    dispatch({ type: 'REMOVE_ITEM', payload: id });
  };
  
  const updateQuantity = (id, quantity) => {
    dispatch({ type: 'UPDATE_QUANTITY', payload: { id, quantity } });
  };
  
  const clearCart = () => {
    dispatch({ type: 'CLEAR_CART' });
  };
  
  const value = {
    items: state.items,
    total: state.total,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart
  };
  
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart debe ser usado dentro de CartProvider');
  }
  return context;
};