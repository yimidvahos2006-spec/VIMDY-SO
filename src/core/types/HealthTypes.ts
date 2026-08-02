export type HealthStatus =
  | 'EXCELLENT'
  | 'GOOD'
  | 'WARNING'
  | 'CRITICAL';

export type HealthColor =
  | 'SUCCESS'
  | 'INFO'
  | 'WARNING'
  | 'DANGER';

export type AITrend =
  | 'UP'
  | 'DOWN'
  | 'STABLE';

export interface HealthInput {
  readonly currentSales: number;
  readonly targetSales: number;

  readonly currentProfit: number;
  readonly targetProfit: number;

  readonly inventoryLevel: number;

  readonly cashBalance: number;

  readonly diff: number;

  readonly retentionRate: number;

  readonly criticalAlerts: number;

  readonly aiTrend: AITrend;
}

export interface HealthResult {
  readonly score: number;
  readonly status: HealthStatus;
  readonly color: HealthColor;
  readonly message: string;
}