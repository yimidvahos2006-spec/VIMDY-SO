import { DashboardEngine } from '../../core/engines/DashboardEngine';
import { DashboardSummary } from '../../core/types/DashboardTypes';

export class DashboardService {
  constructor(
    private readonly engine: DashboardEngine
  ) {}

  public async getExecutiveSummary(): Promise<DashboardSummary> {
    return await this.engine.getExecutiveSummary();
  }
}