import { History, LogOut, MapPin, Zap } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { AIAssistantWidget } from "@/components/shared/AIAssistantWidget";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";

export function DriverLayout() {
  const { name, logout } = useAuth();

  return (
    <div className="app-shell-bg mx-auto flex min-h-screen max-w-md flex-col bg-navy-950 text-white shadow-2xl shadow-black/40">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-navy-950/80 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-red/15 text-brand-red ring-1 ring-inset ring-brand-red/30">
            <Zap className="h-4 w-4" fill="currentColor" />
          </span>
          <div>
            <p className="text-lg font-bold leading-none tracking-tight">
              Charge<span className="text-brand-red">Grid</span>
            </p>
            <p className="mt-1 text-xs text-white/50">Ola, {name}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={logout}>
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </Button>
      </header>
      <main className="flex-1 overflow-y-auto p-4">
        <div className="animate-fade-in-up">
          <Outlet />
        </div>
      </main>
      <nav className="flex border-t border-white/10 bg-navy-950/80 backdrop-blur-md">
        {[
          { to: "/app", label: "Estacoes", icon: MapPin, end: true },
          { to: "/app/historico", label: "Historico", icon: History },
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-1 py-3 text-center text-xs transition-colors duration-200",
                isActive ? "border-t-2 border-brand-red text-white" : "border-t-2 border-transparent text-white/50 hover:text-white/80",
              )
            }
          >
            <item.icon className="h-4 w-4" strokeWidth={2} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <AIAssistantWidget />
    </div>
  );
}
