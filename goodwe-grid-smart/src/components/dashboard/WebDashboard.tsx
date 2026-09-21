import { useState } from "react";
import { DashboardOverview } from "./DashboardOverview";
import { DashboardLoadManagement } from "./DashboardLoadManagement";
import { DashboardChargers } from "./DashboardChargers";
import { DashboardBilling } from "./DashboardBilling";
import { DashboardInsights } from "./DashboardInsights";
import { DashboardUsers } from "./DashboardUsers";
import { DashboardLogs } from "./DashboardLogs";
import { DashboardSimulator } from "./DashboardSimulator";
import { LiveDataProvider, useLiveData } from "./LiveDataProvider";
import { OperatorLogin } from "./OperatorLogin";
import { OperatorAssistantPanel } from "@/components/ai/OperatorAssistantPanel";
import {
  LayoutDashboard, Activity, Plug, Receipt, Brain, Users, Zap, Terminal, Search, Bell, ChevronLeft, BarChart3, Bot, LogOut,
} from "lucide-react";

const tabs = [
  { id: "overview",  label: "Painel Geral",       icon: LayoutDashboard, group: "Operação" },
  { id: "load",      label: "Balanceamento",      icon: Activity,        group: "Operação" },
  { id: "chargers",  label: "Estações",           icon: Plug,            group: "Operação" },
  { id: "assistant", label: "Assistente IA",      icon: Bot,             group: "Operação" },
  { id: "logs",      label: "Logs OCPP",          icon: Terminal,        group: "Engenharia" },
  { id: "insights",  label: "IA & Previsão",      icon: Brain,           group: "Engenharia" },
  { id: "simulator", label: "Simulador",          icon: BarChart3,       group: "Engenharia" },
  { id: "billing",   label: "Faturamento",        icon: Receipt,         group: "Comercial" },
  { id: "users",     label: "Usuários & Frotas",  icon: Users,           group: "Comercial" },
];


function DashboardInner() {
  const [activeTab, setActiveTab] = useState("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const { totals, backend, logout } = useLiveData();
  const active = tabs.find((t) => t.id === activeTab)!;
  const operatorName = backend.operator?.name ?? "Operador";
  const initials = operatorName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "OP";
  // Com o backend ligado e ninguem logado, o console pede login. Sem backend (ou se ele cair): modo simulado.
  const needsLogin = backend.enabled && backend.status !== "error" && !backend.operator;

  const renderPanel = () => {
    switch (activeTab) {
      case "overview": return <DashboardOverview />;
      case "load": return <DashboardLoadManagement />;
      case "chargers": return <DashboardChargers />;
      case "logs": return <DashboardLogs />;
      case "billing": return <DashboardBilling />;
      case "insights": return <DashboardInsights />;
      case "simulator": return <DashboardSimulator />;
      case "users": return <DashboardUsers />;

      default: return <DashboardOverview />;
    }
  };

  const grouped = tabs.reduce<Record<string, typeof tabs>>((acc, t) => {
    (acc[t.group] = acc[t.group] || []).push(t);
    return acc;
  }, {});

  if (needsLogin) return <OperatorLogin />;

  return (
    <div className="flex h-full bg-background grid-bg">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? "w-[68px]" : "w-[232px]"} shrink-0 border-r border-white/5 bg-card/40 backdrop-blur-xl flex flex-col transition-all duration-300`}
      >
        <div className="px-3 py-4 flex items-center justify-between border-b border-white/5">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center glow-red">
                <Zap className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-foreground leading-tight">ChargeGrid</p>
                <p className="text-[9px] text-muted-foreground leading-tight">Operations Console</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
            aria-label="Toggle sidebar"
          >
            <ChevronLeft className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              {!collapsed && (
                <p className="px-2 mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((t) => {
                  const isActive = activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => (t.id === "assistant" ? setAssistantOpen(true) : setActiveTab(t.id))}
                      title={collapsed ? t.label : undefined}
                      className={`group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all ${
                        isActive
                          ? "bg-primary/15 text-primary border border-primary/30"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04] border border-transparent"
                      }`}
                    >
                      <t.icon className={`w-4 h-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                      {!collapsed && <span className="truncate">{t.label}</span>}
                      {!collapsed && isActive && (
                        <span className="ml-auto w-1 h-1 rounded-full bg-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {!collapsed && (
          <div className="m-2 p-3 rounded-lg border border-white/5 bg-black/30">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-muted-foreground">Rede</span>
              <span className="text-[10px] text-goodwe-green font-mono">
                {totals.distributedPower}/{totals.networkLimit} kW
              </span>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  totals.networkLoadPct > 90 ? "bg-primary" : totals.networkLoadPct > 70 ? "bg-goodwe-orange" : "bg-goodwe-green"
                }`}
                style={{ width: `${totals.networkLoadPct}%` }}
              />
            </div>
            <p className="text-[9px] text-muted-foreground mt-1.5">Capacidade contratada</p>
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-white/5 bg-card/30 backdrop-blur-xl">
          <div className="flex items-center gap-3 min-w-0">
            <active.icon className="w-4 h-4 text-primary shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground truncate">{active.label}</h2>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                <span className="status-dot text-goodwe-green" /> Conectado ao CSMS · Atualização ao vivo
                <span
                  className={`ml-1 px-1.5 py-px rounded-full border text-[9px] font-medium ${
                    backend.status === "online"
                      ? "border-goodwe-green/30 bg-goodwe-green/10 text-goodwe-green"
                      : backend.status === "connecting"
                        ? "border-white/10 text-muted-foreground"
                        : "border-goodwe-orange/30 bg-goodwe-orange/10 text-goodwe-orange"
                  }`}
                  title={backend.error}
                >
                  {backend.status === "online"
                    ? `API + ${backend.engine === "postgresql" ? "PostgreSQL" : backend.engine === "sqlite" ? "SQLite (local)" : "banco"}`
                    : backend.status === "connecting"
                      ? "Conectando à API…"
                      : backend.status === "error"
                        ? "API offline · simulação local"
                        : "Simulação local"}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/40 border border-white/5 text-[11px] text-muted-foreground">
              <Search className="w-3.5 h-3.5" />
              <span>Buscar estação, usuário, OCPP…</span>
            </div>
            <button
              onClick={() => setAssistantOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/15 border border-primary/30 text-[11px] font-semibold text-primary hover:bg-primary/25 transition"
            >
              <Bot className="w-3.5 h-3.5" /> Assistente IA
            </button>
            <button className="relative p-2 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground transition">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary" />
            </button>
            <div
              title={backend.operator ? `${operatorName} · ${backend.operator.email}` : "Operador (modo simulado)"}
              className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-goodwe-orange flex items-center justify-center text-[10px] font-bold text-foreground"
            >
              {backend.operator ? initials : "OP"}
            </div>
            {backend.operator && (
              <button
                onClick={() => logout("operator")}
                aria-label="Sair do console"
                title="Sair"
                className="p-2 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          {renderPanel()}
        </div>
      </div>
      <OperatorAssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  );
}

export function WebDashboard() {
  return (
    <LiveDataProvider>
      <DashboardInner />
    </LiveDataProvider>
  );
}
