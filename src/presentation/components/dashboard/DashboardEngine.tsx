import { useEffect, useState } from "react";

export function useDashboardEngine() {

  const [sales, setSales] = useState(2540000);

  const [orders, setOrders] = useState(94);

  const [customers, setCustomers] = useState(186);

  const [products, setProducts] = useState(542);

  useEffect(() => {

    const interval = setInterval(() => {

      setSales(v => v + Math.floor(Math.random() * 25000));

      setOrders(v => v + Math.floor(Math.random() * 2));

      setCustomers(v => v + Math.floor(Math.random() * 2));

      setProducts(v => v);

    }, 4000);

    return () => clearInterval(interval);

  }, []);

  return {

    sales,

    customers,

    orders,

    products

  };

}