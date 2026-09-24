import { ArrowLeft, Calendar, Zap, Clock, MapPin, Battery } from "lucide-react";
import { modeMeta, useLiveData, CompletedSession } from "@/components/dashboard/LiveDataProvider";

interface Props {
  onBack: () => void;
  onNavigate: (screen: string) => void;
}

const fixedHistory: Omit<CompletedSession, "chargerId">[] = [
  { chargerName: "FIAP #1",   vehicle: "BYD Dolphin", userName: "Você", priority: "rapido",      kwh: 28.4, cost: 61.06, durationMin: 42, completedAt: "19/08/2026, 17:32" },
  { chargerName: "FIAP #6", vehicle: "BYD Dolphin", userName: "Você", priority: "eco",         kwh: 15.2, cost: 28.73, durationMin: 68, completedAt: "17/08/2026, 09:15" },
  { chargerName: "FIAP #7", vehicle: "BYD Dolphin", userName: "Você", priority: "garantido",   kwh: 32.1, cost: 79.93, durationMin: 55, completedAt: "14/08/2026, 14:48" },
  { chargerName: "FIAP #3",   vehicle: "BYD Dolphin", userName: "Você", priority: "sustentavel", kwh: 20.5, cost: 38.75, durationMin: 90, completedAt: "11/08/2026, 11:20" },
  { chargerName: "FIAP #6", vehicle: "BYD Dolphin", userName: "Você", priority: "rapido",      kwh: 41.0, cost: 96.35, durationMin: 38, completedAt: "07/08/2026, 16:05" },
  { chargerName: "FIAP #7", vehicle: "BYD Dolphin", userName: "Você", priority: "eco",         kwh: 18.8, cost: 35.53, durationMin: 80, completedAt: "03/08/2026, 08:50" },
];

export function MobileHistory({ onBack, onNavigate }: Props) {
  const { completedSessions, apiHistory, backend } = useLiveData();
  const online = backend.status === "online";
  // Com o backend online mostramos so historico REAL (gravado no banco); o historico
  // fixo de exemplo so aparece na simulacao local, para nao misturar dado real com ficticio.
  const savedIds = new Set(completedSessions.map((s) => s.sessionId).filter(Boolean));
  const fromDatabase = apiHistory.filter((s) => !savedIds.has(s.sessionId));
  const allHistory: Omit<CompletedSession, "chargerId">[] = online
    ? [...completedSessions, ...fromDatabase]
    : [...completedSessions, ...fixedHistory];
  const totalKwh = allHistory.reduce((s, h) => s + h.kwh, 0);
  const totalCost = allHistory.reduce((s, h) => s + h.cost, 0);

  return (
    <div className="relative flex flex-col h-full bg-background">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <h2 className="text-base font-bold text-foreground">Histórico de Recargas</h2>
      </div>

      <div className="px-4">
        <div className="glass-card-glow p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total do mês</p>
          <p className="text-xl font-bold text-foreground tabular-nums">
            {totalKwh.toFixed(1)} kWh · <span className="text-goodwe-green">R$ {totalCost.toFixed(2).replace(".", ",")}</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {allHistory.length} sessões concluídas{online ? " · dados reais do banco" : " · histórico de exemplo"}
          </p>
        </div>
      </div>

      <div className="flex-1 px-4 mt-3 overflow-y-auto pb-20 space-y-2.5">
        {online && allHistory.length === 0 && (
          <p className="text-xs text-muted-foreground text-center pt-6">
            Nenhuma sessão gravada ainda. Inicie e finalize uma recarga para ver o comprovante aqui.
          </p>
        )}
        {allHistory.map((s, i) => {
          const meta = modeMeta[s.priority];
          const isLive = i < completedSessions.length;
          return (
            <div key={i} className={`glass-card p-3 ${isLive ? "border-goodwe-blue/30" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-foreground">{s.chargerName}</h4>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Calendar className="w-3 h-3" /> {s.completedAt} · {s.vehicle}
                  </p>
                </div>
                <span className={`text-[9px] px-2 py-0.5 rounded-full border shrink-0 ${meta.cls}`}>
                  {meta.emoji} {meta.label}
                </span>
              </div>
              {s.sessionId && (
                <p className="text-[9px] text-muted-foreground/70 font-mono mt-1.5">
                  Sessão #{s.sessionId} · {s.receipt ? `Comprovante ${s.receipt}` : "sem comprovante ainda"}
                </p>
              )}
              {s.priceNote && <p className="text-[9px] text-muted-foreground/70 mt-0.5">{s.priceNote}</p>}
              <div className="flex items-center justify-between mt-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1 tabular-nums">
                    <Clock className="w-3 h-3" /> {s.durationMin} min
                  </span>
                  <span className="text-[10px] text-goodwe-blue flex items-center gap-1 tabular-nums">
                    <Zap className="w-3 h-3" /> {s.kwh.toFixed(1)} kWh
                  </span>
                </div>
                <span className="text-sm font-bold text-goodwe-green tabular-nums">
                  R$ {s.cost.toFixed(2).replace(".", ",")}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* navegação inferior */}
      <div className="absolute bottom-0 left-0 right-0 h-14 bg-goodwe-card/90 backdrop-blur-lg border-t border-white/5 flex items-center justify-around px-4">
        {[
          { icon: Zap, label: "Início", active: false, screen: "home" },
          { icon: MapPin, label: "Mapa", active: false, screen: "map" },
          { icon: Battery, label: "Histórico", active: true, screen: "history" },
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
