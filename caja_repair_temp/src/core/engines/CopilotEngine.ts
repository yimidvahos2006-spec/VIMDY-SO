import { BusinessAnalyzer } from "./BusinessAnalyzer";
import { PatternLearningEngine } from "./PatternLearningEngine";
import { CopilotContextSnapshot } from "../types/CopilotTypes";

/**
 * CopilotEngine
 * ---------------------------------------------------------------------------
 * Capa fina usada por CopilotService. Toda la lógica de agregación real
 * (ventas, inventario, cocina, caja, mesas, clientes, alertas y
 * predicciones) vive en BusinessAnalyzer — el "cerebro" del estado ACTUAL
 * del negocio (FASE 2). PatternLearningEngine (PASO 9) aporta la otra
 * mitad: patrones detectados sobre el historial acumulado día a día.
 * CopilotEngine combina ambas fuentes en el snapshot final que recibe el
 * Copiloto, sin que BusinessAnalyzer y PatternLearningEngine necesiten
 * conocerse entre sí.
 */
export class CopilotEngine {
  constructor(
    private readonly businessAnalyzer: BusinessAnalyzer,
    private readonly patternLearning: PatternLearningEngine
  ) {}

  public async buildContextSnapshot(
    businessName: string,
    currency: string
  ): Promise<CopilotContextSnapshot> {
    const [snapshot, learnedPatterns] = await Promise.all([
      this.businessAnalyzer.buildSnapshot(businessName, currency),
      this.patternLearning.detectPatterns()
    ]);

    return { ...snapshot, learnedPatterns };
  }
}