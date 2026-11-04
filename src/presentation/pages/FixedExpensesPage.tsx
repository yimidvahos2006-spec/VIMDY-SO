import React from "react";
import { FixedExpensesPanel } from "../components/accounting/FixedExpensesPanel";
import { RequirePermission } from "../navigation/RequirePermission";

/**
 * VIMDY Contable — Gastos fijos.
 *
 * Capas de protección (de afuera hacia adentro):
 *  1. routes/App.tsx: ProtectedRoute (permiso "accounting.view") + RequireModule
 *     ("contable" activo en la configuración del negocio).
 *  2. Esta página: RequirePermission, por si alguien monta el panel en otro
 *     lugar del árbol sin pasar por la ruta.
 *  3. FixedExpensesPanel: revisa el rol (ADMIN, GERENTE, CONTADOR) y solo deja
 *     registrar/borrar a ADMIN y GERENTE.
 *  4. Base de datos: RLS de fixed_expenses (la defensa real).
 */
export const FixedExpensesPage: React.FC = () => {
  return (
    <RequirePermission requires="accounting.view">
      <div className="min-h-screen p-8">
        <FixedExpensesPanel />
      </div>
    </RequirePermission>
  );
};