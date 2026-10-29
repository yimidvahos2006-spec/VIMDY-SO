import React from "react";
import { Users, Wallet, Sparkles, Crown } from "lucide-react";

import { CustomersKpis } from "../../../core/store/useCustomers";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { CustomerKpiCard } from "./CustomerKpiCard";

export function CustomerKpiGrid({ kpis }: { kpis: CustomersKpis }) {
  const { money } = useTranslation();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4">
      <CustomerKpiCard
        icon={<Users size={20} className="text-vimdy-accent-hover" />}
        label="Total de clientes"
        value={kpis.totalCustomers.toString()}
      />
      <CustomerKpiCard
        icon={<Wallet size={20} className="text-green-400" />}
        label="Valor generado (LTV)"
        value={money(kpis.totalLtv)}
      />
      <CustomerKpiCard
        icon={<Sparkles size={20} className="text-yellow-400" />}
        label="Puntos acumulados"
        value={kpis.totalPoints.toLocaleString("es-CO")}
      />
      <CustomerKpiCard
        icon={<Crown size={20} className="text-orange-400" />}
        label="Mejor cliente"
        value={kpis.topCustomer ? kpis.topCustomer.name : "—"}
      />
    </div>
  );
}