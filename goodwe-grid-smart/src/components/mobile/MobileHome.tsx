import { useMemo, useState } from "react";
import { MapPin, Zap, Battery, Search, AlertTriangle } from "lucide-react";
import { useLiveData, statusMeta, modeMeta } from "@/components/dashboard/LiveDataProvider";
import { MobileAssistant } from "@/components/ai/MobileAssistant";

interface Props {
  onNavigate: (screen: string) => void;
  onSelectCharger: (id: string) => void;
}

export function MobileHome({ onNavigate, onSelectCharger }: Props) {
  const { chargers, backend } = useLiveData();
  const userName = backend.driver?.name ?? "João Silva"; // sem login (modo simulado): persona de exemplo
  const firstName = userName.split(" ")[0];
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = chargers.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        statusMeta[c.status].label.toLowerCase().includes(q)
      );
    });
    const map = new Map<string, typeof filtered>();
    filtered.forEach((c) => {
      const loc = c.name.split(" ")[0];
      map.set(loc, [...(map.get(loc) ?? []), c]);
    });
    return Array.from(map.entries());
  }, [chargers, query]);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Olá, {firstName}</p>
            <h2 className="text-lg font-bold text-foreground">Encontrar Estação</h2>
          </div>
          <button
            onClick={() => onNavigate("profile")}
            className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center"
          >
            <span className="text-sm font-bold text-primary">{firstName.charAt(0).toUpperCase()}</span>
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, tipo ou status..."
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
      </div>

      <div className="flex-1 px-4 overflow-y-auto pb-20 space-y-4">
        {groups.map(([loc, list]) => (
          <div key={loc}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-3 h-3" /> {loc}
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {list.filter((c) => c.status === "available").length} livres
              </span>
            </div>
            <div className="space-y-2.5">
              {list.map((c) => {
                const meta = statusMeta[c.status];
                const busy = c.status === "charging" || c.status === "preparing";
                return (
                  <div key={c.id} className="glass-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-foreground">{c.name}</h4>
                        <p className="text-[10px] text-muted-foreground font-mono">{c.id} · {c.type}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full font-medium border shrink-0 ${c.status === "faulted" ? "bg-primary/15 text-primary border-primary/30" : meta.cls}`}>
                        <span className={`status-dot ${meta.dot}`} />
                        {c.status === "faulted" ? "Manutenção" : meta.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Zap className="w-3 h-3" /> {c.currentPower.toFixed(1)} / {c.maxPower} kW
                      </span>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Battery className="w-3 h-3" /> R$ {c.tariff.toFixed(2).replace(".", ",")}/kWh
                      </span>
                    </div>

                    {busy && (
                      <div className="mt-2.5">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                          <span className="truncate">{c.user} · {c.vehicle}</span>
                          <span className="tabular-nums">{Math.round(c.pct)}% · {c.etaMin} min</span>
                        </div>
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-goodwe-blue to-goodwe-green rounded-full transition-all duration-700" style={{ width: `${c.pct}%` }} />
                        </div>
                        {c.mode && (
                          <span className={`inline-block mt-2 text-[9px] px-2 py-0.5 rounded-full border ${modeMeta[c.mode].cls}`}>
                            {modeMeta[c.mode].emoji} {modeMeta[c.mode].label}
                          </span>
                        )}
                      </div>
                    )}

                    {c.status === "faulted" && (
                      <p className="mt-2 text-[10px] text-primary/90 bg-primary/10 border border-primary/20 rounded-md px-2 py-1.5 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3" /> Indisponível · manutenção em andamento
                      </p>
                    )}

                    {c.status === "available" && (
                      <button
                        onClick={() => { onSelectCharger(c.id); onNavigate("chargerDetail"); }}
                        className="mt-2.5 w-full py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
                      >
                        Reservar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="text-xs text-muted-foreground text-center pt-8">Nenhuma estação encontrada.</p>
        )}
      </div>

      <MobileAssistant />

      <div className="absolute bottom-0 left-0 right-0 h-14 bg-goodwe-card/90 backdrop-blur-lg border-t border-white/5 flex items-center justify-around px-4">
        {[
          { icon: Zap, label: "Início", active: true, screen: "home" },
          { icon: MapPin, label: "Mapa", screen: "map" },
          { icon: Battery, label: "Histórico", screen: "history" },
        ].map((item, i) => (
          <button key={i} onClick={() => onNavigate(item.screen)} className="flex flex-col items-center gap-0.5">
            <item.icon className={`w-5 h-5 ${item.active ? "text-primary" : "text-muted-foreground"}`} />
            <span className={`text-[10px] ${item.active ? "text-primary font-medium" : "text-muted-foreground"}`}>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
