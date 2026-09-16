import { NavLink, Outlet } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";

const NAV_SECTIONS = [
  {
    title: "Operacao",
    items: [
      { to: "/operador", label: "Painel Geral", end: true },
      { to: "/operador/balanceamento", label: "Balanceamento" },
      { to: "/operador/estacoes", label: "Estacoes" },
      { to: "/operador/assistente-ia", label: "Assistente IA" },
    ],
  },
  {
    title: "Engenharia",
    items: [
      { to: "/operador/engenharia/logs-ocpp", label: "Logs OCPP" },
      { to: "/operador/engenharia/ia-previsao", label: "IA e Previsao" },
      { to: "/operador/engenharia/simulador", label: "Simulador" },
    ],
  },
  {
    title: "Comercial",
    items: [
      { to: "/operador/comercial/faturamento", label: "Faturamento" },
      { to: "/operador/comercial/usuarios-frotas", label: "Usuarios e Frotas" },
    ],
  },
];

export function OperatorLayout() {
  const { name, logout } = useAuth();

  return (
    <div className="flex min-h-screen bg-navy-950 text-white">
      <aside className="w-64 shrink-0 border-r border-white/10 bg-navy-900 p-4">
        <div className="mb-6 px-2">
          <p className="text-lg font-bold tracking-tight">
            Charge<span className="text-brand-red">Grid</span>
          </p>
          <p className="text-xs text-white/50">Console do Operador GoodWe</p>
        </div>
        <nav className="space-y-6">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                {section.title}
              </p>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "block rounded-lg px-3 py-2 text-sm transition-colors",
                        isActive ? "bg-brand-red text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 bg-navy-900/60 px-6 py-3">
          <p className="text-sm text-white/70">Bem-vindo, {name}</p>
          <Button variant="outline" size="sm" onClick={logout}>
            Sair
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
