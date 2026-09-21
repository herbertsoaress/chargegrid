import { useState } from "react";
import { Zap, Smartphone, Monitor } from "lucide-react";
import { Link } from "react-router-dom";
import { MobileApp } from "@/components/mobile/MobileApp";
import { WebDashboard } from "@/components/dashboard/WebDashboard";
import { LiveDataProvider } from "@/components/dashboard/LiveDataProvider";

// Um UNICO LiveDataProvider envolve app e dashboard. Sem isto, MobileApp e WebDashboard
// (irmaos na arvore) criavam cada um a sua simulacao, e o que o motorista fazia no app
// nao aparecia no dashboard. Os providers internos detectam este e nao duplicam o estado.
const Index = () => (
  <LiveDataProvider>
    <IndexContent />
  </LiveDataProvider>
);

const IndexContent = () => {
  const [view, setView] = useState<"both" | "mobile" | "dashboard">("both");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-white/5 px-4 lg:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center glow-red">
            <Zap className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground">
              GoodWe <span className="text-primary">ChargeGrid</span> Intelligence
            </h1>
            <p className="text-[10px] text-muted-foreground">MVP Vision</p>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 text-xs">
            <Link to="/assistente" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition font-medium">Assistente IA</Link>
            <Link to="/dashboard" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition font-medium">Estações</Link>
          </nav>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          {[
            { id: "both" as const, label: "Ambos", icon: null },
            { id: "mobile" as const, label: "App", icon: Smartphone },
            { id: "dashboard" as const, label: "Dashboard", icon: Monitor },
          ].map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                view === v.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v.icon && <v.icon className="w-3.5 h-3.5" />}
              {v.label}
            </button>
          ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Mobile */}
        {(view === "both" || view === "mobile") && (
          <div className={`flex items-center justify-center p-6 ${
            view === "both" ? "w-[380px] min-w-[380px] border-r border-white/5" : "w-full"
          }`}>
            <MobileApp />
          </div>
        )}

        {/* Dashboard */}
        {(view === "both" || view === "dashboard") && (
          <div className="flex-1 overflow-y-auto">
            <WebDashboard />
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
