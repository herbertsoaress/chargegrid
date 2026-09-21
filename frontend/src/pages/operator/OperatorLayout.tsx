import {
  Bot,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Plug,
  Receipt,
  Scale,
  TrendingUp,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Operacao",
    items: [
      { to: "/operador", label: "Painel Geral", icon: LayoutDashboard, end: true },
      { to: "/operador/balanceamento", label: "Balanceamento", icon: Scale },
      { to: "/operador/estacoes", label: "Estacoes", icon: Plug },
      { to: "/operador/assistente-ia", label: "Assistente IA", icon: Bot },
    ],
  },
  {
    title: "Engenharia",
    items: [
      { to: "/operador/engenharia/logs-ocpp", label: "Logs OCPP", icon: FileText },
      { to: "/operador/engenharia/ia-previsao", label: "IA e Previsao", icon: TrendingUp },
      { to: "/operador/engenharia/simulador", label: "Simulador", icon: FlaskConical },
    ],
  },
  {
    title: "Comercial",
    items: [
      { to: "/operador/comercial/faturamento", label: "Faturamento", icon: Receipt },
      { to: "/operador/comercial/usuarios-frotas", label: "Usuarios e Frotas", icon: Users },
    ],
  },
];

export function OperatorLayout() {
  const { name, logout } = useAuth();

  return (
    <div className="app-shell-bg flex min-h-screen bg-navy-950 text-white">
      <aside className="w-64 shrink-0 border-r border-white/10 bg-navy-900/80 p-4 backdrop-blur-sm">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-red/15 text-brand-red ring-1 ring-inset ring-brand-red/30">
            <Zap className="h-4 w-4" fill="currentColor" />
          </span>
          <div>
            <p className="text-lg font-bold leading-none tracking-tight">
              Charge<span className="text-brand-red">Grid</span>
            </p>
            <p className="mt-1 text-xs text-white/50">Console do Operador GoodWe</p>
          </div>
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
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-200",
                        isActive
                          ? "bg-brand-red text-white shadow-md shadow-brand-red/25"
                          : "text-white/70 hover:bg-white/5 hover:text-white",
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-navy-900/60 px-6 py-3 backdrop-blur-md">
          <p className="text-sm text-white/70">
            Bem-vindo, <span className="font-medium text-white">{name}</span>
          </p>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut className="h-3.5 w-3.5" />
            Sair
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <div className="animate-fade-in-up">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
