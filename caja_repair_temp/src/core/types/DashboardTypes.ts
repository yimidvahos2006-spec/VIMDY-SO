import type {
  Sale,
  Customer,
  KitchenOrder,
  Alert
} from '../entities/Entities';

import type { HealthResult } from './HealthTypes';

export interface DashboardSummary {
  readonly health: HealthResult;

  readonly sales: Sale[];

  readonly customers: Customer[];

  readonly kitchen: KitchenOrder[];

  readonly alerts: Alert[];

  readonly aiRecommendations: string[];
}