import { Link, useLocation } from "wouter";
import { Users, KanbanSquare } from "lucide-react";

export function CrmTabs() {
  const [location] = useLocation();
  const isKanban = location === "/crm/funil";

  return (
    <div className="flex border-b border-gray-200 bg-white px-8">
      <Link href="/crm">
        <div
          className={`flex items-center gap-2 px-4 py-4 border-b-2 font-medium text-sm cursor-pointer transition-colors ${
            !isKanban
              ? "border-[#25D366] text-[#25D366]"
              : "border-transparent text-gray-500 hover:text-gray-900"
          }`}
        >
          <Users className="w-4 h-4" />
          Contatos
        </div>
      </Link>
      <Link href="/crm/funil">
        <div
          className={`flex items-center gap-2 px-4 py-4 border-b-2 font-medium text-sm cursor-pointer transition-colors ${
            isKanban
              ? "border-[#25D366] text-[#25D366]"
              : "border-transparent text-gray-500 hover:text-gray-900"
          }`}
        >
          <KanbanSquare className="w-4 h-4" />
          Funil de Vendas
        </div>
      </Link>
    </div>
  );
}
