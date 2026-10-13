import { EmptyState } from "../ui/EmptyState";
import { Package, Plus } from "lucide-react";

export function EmptyProductsState({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      icon={<Package size={28} />}
      title="Todavía no tienes productos."
      description="Crea tu primer producto para empezar a vender desde Caja y controlar tu inventario."
      action={{ label: "Crear mi primer producto", onClick: onCreate, icon: <Plus size={18} /> }}
    />
  );
}