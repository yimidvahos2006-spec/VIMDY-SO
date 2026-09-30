import type { DashboardAdaptiveModel } from "./DashboardAdaptiveTypes";

export type DashboardIndicatorId = "sales" | "profit" | "cash" | "orders" | "health";
export type DashboardQuickActionId = "newSale" | "newCustomer" | "newProduct" | "newOrder";

const INDICATORS: readonly DashboardIndicatorId[] = [
  "sales",
  "profit",
  "cash",
  "orders",
  "health",
];

const QUICK_ACTIONS: readonly DashboardQuickActionId[] = [
  "newSale",
  "newCustomer",
  "newProduct",
  "newOrder",
];

export function getVisibleDashboardIndicators(
  model: DashboardAdaptiveModel,
): readonly DashboardIndicatorId[] {
  if (!model.isReady) return [];

  return INDICATORS.filter((id) => {
    switch (id) {
      case "sales":
      case "profit":
      case "health":
        // These executive indicators are meaningful when the business
        // actually records sales. They do not imply an "orders" workflow.
        return model.capabilities.sales && model.metrics.netSales;
      case "cash":
        return model.capabilities.cash && model.metrics.cash;
      case "orders":
        // An "orders" indicator is a workflow/capability signal, not the
        // same thing as transactionCount. A business can record sales without
        // operating an order workflow, so never infer this from sales alone.
        return model.capabilities.orders && model.metrics.transactionCount;
    }
  });
}

export function getVisibleDashboardQuickActions(
  model: DashboardAdaptiveModel,
): readonly DashboardQuickActionId[] {
  if (!model.isReady) return [];

  return QUICK_ACTIONS.filter((id) => model.actions[id]);
}

export function shouldShowDailyReport(
  model: DashboardAdaptiveModel,
): boolean {
  return model.isReady && model.sections.dailyReport;
}
