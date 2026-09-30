import type { Shift } from "../../entities/Entities";

export type DashboardCashDayStatus = "CLOSED" | "OPEN" | "NO_SHIFT";

export interface DashboardCashReconciliation {
  readonly status: DashboardCashDayStatus;
  readonly generatedAt: Date;
  readonly timezone: string;
  readonly shiftCount: number;
  readonly closedShiftCount: number;
  readonly openShiftCount: number;

  /** Turno cerrado más reciente dentro del día, si existe. */
  readonly latestClosedShift: Shift | null;
  /** Turno abierto actual dentro del día, si existe. */
  readonly openShift: Shift | null;

  /** Totales acumulados de todos los turnos cerrados del día. */
  readonly totalIncome: number | null;
  readonly totalCashIncome: number | null;
  readonly totalExpense: number | null;
  readonly incomeByMethod: Readonly<Record<string, number>>;

  /**
   * El cierre físico de un día NO se suma entre turnos: corresponde al último
   * turno cerrado. Si el día aún tiene un turno abierto, estos valores no son
   * un cierre definitivo.
   */
  readonly closingExpectedAmount: number | null;
  readonly closingCountedAmount: number | null;
  readonly closingDifference: number | null;

  /** True solo si todos los datos necesarios para el cierre vienen completos. */
  readonly closingDataComplete: boolean;
}
