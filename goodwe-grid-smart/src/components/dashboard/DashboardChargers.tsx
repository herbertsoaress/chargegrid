import { useState } from "react";
import { Plug, Clock, DollarSign, ChevronDown, ChevronUp } from "lucide-react";
import { useLiveData, statusMeta, modeMeta, ChargerStatus } from "./LiveDataProvider";

export function DashboardChargers() {
  const { chargers, persistedSessionIds, backend } = useLiveData();
  const online = backend.status === "online";
  const [filter, setFilter] = useState<"all" | ChargerStatus>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const order: ChargerStatus[] = ["charging", "preparing", "finishing", "available", "faulted"];

  const filterButtons = [
    { key: "all", label: "Todos" },
    { key: "available", label: "Disponível" },
    { key: "charging", label: "Carregando" },
    { key: "faulted", label: "Falha" },
  ];

  const filtered = filter === "all" ? chargers : chargers.filter((c) => c.status === filter);
  const sorted = [...filtered].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Estações de Carregamento</h3>
          <p className="text-[11px] text-muted-foreground">{chargers.length} pontos OCPP 1.6J · atualização ao vivo</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {order.map((s) => (
            <span key={s} className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full font-medium border ${statusMeta[s].cls}`}>
              <span className={`status-dot ${statusMeta[s].dot}`} />
              {chargers.filter((c) => c.status === s).length} {statusMeta[s].label}
            </span>
          ))}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        {filterButtons.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as typeof filter)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition font-medium ${
              filter === f.key
                ? "bg-primary/20 text-primary border-primary/40"
                : "bg-black/20 text-muted-foreground border-white/10 hover:border-white/20"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Grid de cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map((c) => {
          const meta = statusMeta[c.status];
          const isLive = c.status === "charging" || c.status === "preparing";
          const isOpen = expanded === c.id;
          const sessionKwh = c.sessionKwh ?? 0;
          const cost = (sessionKwh * c.tariff).toFixed(2);

          return (
            <div key={c.id} className={`glass-card card-hover p-4 ${isLive ? "border-goodwe-blue/30" : c.status === "faulted" ? "border-primary/30" : ""}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center ${isLive ? "bg-goodwe-blue/15" : c.status === "faulted" ? "bg-primary/15" : "bg-goodwe-green/15"}`}>
                    <Plug className={`w-4 h-4 ${meta.dot}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground leading-tight">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{c.id} · {c.type}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full font-medium border ${meta.cls}`}>
                  <span className={`status-dot ${meta.dot}`} /> {meta.label}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="rounded-lg bg-black/30 border border-white/5 p-2">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Potência</p>
                  <p className="text-base font-bold text-goodwe-blue tabular-nums">{c.currentPower.toFixed(1)} <span className="text-[10px] text-muted-foreground">/ {c.maxPower} kW</span></p>
                </div>
                <div className="rounded-lg bg-black/30 border border-white/5 p-2">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><DollarSign className="w-2.5 h-2.5" /> Tarifa</p>
                  <p className="text-base font-bold text-goodwe-orange tabular-nums">R$ {c.tariff.toFixed(2)}<span className="text-[10px] text-muted-foreground">/kWh</span></p>
                </div>
              </div>

              {/* Modo (se ativo) */}
              {c.mode && (
                <div className="mb-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${modeMeta[c.mode].cls}`}>
                    {modeMeta[c.mode].emoji} {modeMeta[c.mode].label}
                  </span>
                  {c.departureTime && (
                    <span className="ml-2 text-[10px] text-muted-foreground">· Saída {c.departureTime}</span>
                  )}
                </div>
              )}

              {isLive || c.status === "finishing" ? (
                <>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                    <span>
                      {c.vehicle} · {c.user}
                      {online && !persistedSessionIds[c.id] && (
                        <span className="ml-1.5 rounded border border-goodwe-orange/40 px-1 text-[9px] uppercase text-goodwe-orange" title="Sessão de demonstração do navegador: não está no banco">simulado</span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 tabular-nums"><Clock className="w-3 h-3" /> {c.etaMin} min</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-goodwe-blue to-goodwe-green rounded-full transition-all duration-700" style={{ width: `${c.pct}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground text-right mt-1 tabular-nums">{Math.round(c.pct)}% completo · {sessionKwh.toFixed(1)} kWh</p>
                </>
              ) : c.status === "faulted" ? (
                <p className="text-[11px] text-primary/90 bg-primary/10 border border-primary/20 rounded-md px-2 py-1.5">
                  Erro: comunicação OCPP perdida · manutenção agendada
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground bg-white/[0.02] border border-white/5 rounded-md px-2 py-1.5">
                  Aguardando conexão · pronto para iniciar transação
                </p>
              )}

              {/* Botão expandir detalhes */}
              <button
                onClick={() => setExpanded(isOpen ? null : c.id)}
                className="mt-3 w-full flex items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition border-t border-white/5 pt-2"
              >
                {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {isOpen ? "Ocultar detalhes" : "Ver detalhes"}
              </button>

              {/* Painel expandido */}
              {isOpen && (
                <div className="mt-2 pt-2 border-t border-white/5 grid grid-cols-3 gap-2">
                  <div className="rounded-md bg-black/30 border border-white/5 p-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Tarifa</p>
                    <p className="text-xs font-bold text-goodwe-orange tabular-nums">R$ {c.tariff.toFixed(2)}/kWh</p>
                  </div>
                  <div className="rounded-md bg-black/30 border border-white/5 p-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Custo sess.</p>
                    <p className="text-xs font-bold text-goodwe-green tabular-nums">R$ {cost}</p>
                  </div>
                  <div className="rounded-md bg-black/30 border border-white/5 p-2 text-center">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Pot. máx.</p>
                    <p className="text-xs font-bold text-goodwe-blue tabular-nums">{c.maxPower} kW</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
