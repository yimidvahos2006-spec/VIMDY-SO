import { SaleItem } from "../entities/Entities";

export interface HistoricalLineProfitResult {
  cost: number;
  profit: number;
  costUnreliable: boolean;
}

export function getHistoricalLineProfit(
  item: { productId: string; quantity: number; price: number; unitCostAtSale?: number; costUnreliableAtSale?: boolean }
): HistoricalLineProfitResult {
  if (item.unitCostAtSale === undefined) {
    return { cost: 0, profit: 0, costUnreliable: true };
  }
  if (item.costUnreliableAtSale === true) {
    return { cost: 0, profit: 0, costUnreliable: true };
  }
  const cost = item.unitCostAtSale * item.quantity;
  const revenue = item.price * item.quantity;
  const profit = revenue - cost;
  return { cost, profit, costUnreliable: false };
}
