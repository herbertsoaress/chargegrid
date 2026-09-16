import { NavLink, Outlet } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";

export function DriverLayout() {
  const { name, logout } = useAuth();

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-navy-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-lg font-bold tracking-tight">
            Charge<span className="text-brand-red">Grid</span>
          </p>
          <p className="text-xs text-white/50">Ola, {name}</p>
        </div>
        <Button variant="outline" size="sm" onClick={logout}>
          Sair
        </Button>
      </header>
      <main className="flex-1 overflow-y-auto p-4">
        <Outlet />
      </main>
      <nav className="flex border-t border-white/10">
        {[
          { to: "/app", label: "Estacoes", end: true },
          { to: "/app/historico", label: "Historico" },
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex-1 py-3 text-center text-sm",
                isActive ? "border-t-2 border-brand-red text-white" : "text-white/50",
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
