// src/components/POSMain.jsx
import { useState, useEffect } from 'react';
import { useCart } from '../context/CartContext';
import { supabase } from '../lib/supabaseClient';
import { calculateDianTotals } from '../utils/dianHelper';

const POSMain = () => {
  const { items, addToCart, removeFromCart, updateQuantity, clearCart } = useCart();
  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processingPayment, setProcessingPayment] = useState(false);

  // Calcular subtotales, impuestos (INC 8%) y total en tiempo real
  const dianTotals = calculateDianTotals(items, 'INC');

  // Cargar productos al iniciar
  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name');
      
      if (error) throw error;
      setProducts(data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Filtrar productos por búsqueda
  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.sku?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Verificar stock disponible localmente
  const checkStock = (product, quantity = 1) => {
    const currentQuantity = items
      .filter(item => item.id === product.id)
      .reduce((sum, item) => sum + item.quantity, 0);
    
    return currentQuantity + quantity <= product.stock;
  };

  const handleAddToCart = (product, quantity = 1) => {
    if (!checkStock(product, quantity)) {
      alert(`Stock insuficiente. Solo hay ${product.stock} unidades disponibles.`);
      return;
    }
    addToCart(product, quantity);
  };

  // Cobro atómico y seguro usando la función RPC de Supabase que creamos
  const handleCheckout = async () => {
    if (items.length === 0) {
      alert('El carrito está vacío');
      return;
    }

    setProcessingPayment(true);
    
    try {
      // Formatear los ítems para enviarlos a la base de datos de manera limpia
      const rpcItems = items.map(item => ({
        id: item.id,
        quantity: item.quantity,
        price: item.price
      }));

      // Ejecutar la transacción segura en Supabase (crea la venta y descuenta stock)
      const { data, error: rpcError } = await supabase.rpc('process_sale', {
        p_items: rpcItems,
        p_total: dianTotals.total,
        p_inc: dianTotals.tax,
        p_payment_method: 'Efectivo/POS'
      });

      if (rpcError) throw rpcError;

      // Limpiar carrito y actualizar inventario en pantalla
      clearCart();
      await fetchProducts();
      alert(`¡Venta completada con éxito! ID: ${data.sale_id}`);
      
    } catch (err) {
      console.error('Error en checkout:', err);
      alert(`Error al procesar la venta: ${err.message || 'Intente nuevamente.'}`);
    } finally {
      setProcessingPayment(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
        <p>Error al cargar productos: {error}</p>
        <button 
          onClick={fetchProducts}
          className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-50">
      {/* Panel de productos */}
      <div className="flex-1 p-4 overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">Punto de Venta - VIMDY</h2>
        
        <div className="mb-4">
          <input
            type="text"
            placeholder="Buscar producto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredProducts.map((product) => (
            <div 
              key={product.id}
              className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                <h3 className="font-semibold text-gray-800">{product.name}</h3>
                <p className="text-sm text-gray-600">{product.description}</p>
              </div>
              <div className="mt-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold text-lg">${product.price.toFixed(2)}</span>
                  <span className={`text-sm ${product.stock <= 10 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                    Stock: {product.stock}
                  </span>
                </div>
                <button
                  onClick={() => handleAddToCart(product)}
                  disabled={product.stock === 0}
                  className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {product.stock === 0 ? 'Agotado' : 'Agregar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Panel de carrito y resumen de impuestos */}
      <div className="w-96 bg-white border-l border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800">Carrito de Compra</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="text-gray-500 text-center mt-10">Carrito vacío</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-gray-800">{item.name}</h4>
                    <p className="text-sm text-gray-600">${item.price.toFixed(2)} c/u</p>
                  </div>
                  <button
                    onClick={() => removeFromCart(item.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => {
                        const product = products.find(p => p.id === item.id);
                        if (product && checkStock(product, 1)) {
                          updateQuantity(item.id, item.quantity + 1);
                        } else {
                          alert('Stock insuficiente');
                        }
                      }}
                      className="w-8 h-8 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300 font-bold"
                    >
                      +
                    </button>
                    <span className="font-semibold">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                      className="w-8 h-8 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300 font-bold"
                    >
                      -
                    </button>
                  </div>
                  <span className="font-bold text-gray-800">${item.subtotal.toFixed(2)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sección de Totales, Impuesto DIAN (INC 8%) y Cobro */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="space-y-1 text-sm mb-3">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal:</span>
              <span>${dianTotals.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>{dianTotals.taxName}:</span>
              <span>${dianTotals.tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-gray-800 pt-2 border-t border-gray-200">
              <span>Total a Pagar:</span>
              <span>${dianTotals.total.toFixed(2)}</span>
            </div>
          </div>
          
          <button
            onClick={handleCheckout}
            disabled={items.length === 0 || processingPayment}
            className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-bold shadow-sm"
          >
            {processingPayment ? 'Procesando...' : 'Cobrar'}
          </button>
          
          {items.length > 0 && (
            <button
              onClick={clearCart}
              className="w-full mt-2 py-2 text-red-500 hover:text-red-700 text-sm font-medium"
            >
              Vaciar Carrito
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default POSMain;