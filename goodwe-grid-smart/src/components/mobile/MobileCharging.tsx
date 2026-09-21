import { ArrowLeft, Zap, BatteryCharging, Clock, DollarSign, Square } from "lucide-react";
import { toast } from "sonner";
import { useLiveData, modeMeta } from "@/components/dashboard/LiveDataProvider";

interface Props {
  chargerId: string | null;
  onBack: () => void;
}

export function MobileCharging({ chargerId, onBack }: Props) {
  const { chargers, activeSessions, endSession, persistedSessionIds } = useLiveData();
  const session = activeSessions.find((s) => s.chargerId === chargerId);
  const charger = chargers.find((c) => c.id === chargerId);

  if (!session || !charger) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="px-4 pt-4 pb-3 flex items-center gap-3">
          <button onClick={onBack} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
            <ArrowLeft className="w-4 h-4 text-foreground" />
          </button>
          <h2 className="text-base font-bold text-foreground">Recarga</h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <BatteryCharging className="w-10 h-10 text-muted-foreground" />
          <p className="text-sm text-foreground font-semibold">Nenhuma recarga ativa</p>
          <p className="text-xs text-muted-foreground">Selecione uma estação disponível no mapa para iniciar uma sessão.</p>
        </div>
      </div>
    );
  }

  const meta = modeMeta[session.priority];
  const R = 52;
  const C = 2 * Math.PI * R;
  const remainingMin = charger.etaMin;
  const eta = new Date(Date.now() + remainingMin * 60_000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const finish = () => {
    endSession(session.chargerId);
    toast.success("Recarga finalizada", {
      description: `${session.kwh.toFixed(1)} kWh · R$ ${session.estimatedCost.toFixed(2).replace(".", ",")}`,
    });
    onBack();
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <div>
          <h2 className="text-base font-bold text-foreground">{charger.name}</h2>
          <p className="text-[10px] text-muted-foreground font-mono">{charger.id} · {session.vehicle}</p>
          {persistedSessionIds[charger.id] && (
            <p className="text-[9px] text-goodwe-green flex items-center gap-1 mt-0.5">
              <span className="status-dot text-goodwe-green" /> Sessão #{persistedSessionIds[charger.id]} salva no banco
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 px-4 overflow-y-auto pb-6 space-y-3">
        <div className="flex flex-col items-center pt-2">
          <svg width="140" height="140" className="-rotate-90">
            <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
            <circle
              cx="70" cy="70" r={R} fill="none" stroke="#00AEEF" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C - (Math.min(100, session.currentPct) / 100) * C}
              style={{ transition: "stroke-dashoffset 0.7s ease" }}
            />
          </svg>
          <div className="-mt-[104px] flex flex-col items-center">
            <p className="text-3xl font-bold text-foreground tabular-nums">{Math.round(session.currentPct)}%</p>
            <p className="text-[10px] text-muted-foreground">meta {session.targetPct}%</p>
          </div>
          <span className={`mt-14 text-[10px] px-2.5 py-1 rounded-full border ${meta.cls}`}>
            {meta.emoji} {meta.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="glass-card p-3">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3" /> Potência atual</p>
            <p className="text-lg font-bold text-goodwe-blue tabular-nums">{session.currentPower.toFixed(1)} kW</p>
          </div>
          <div className="glass-card p-3">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1"><BatteryCharging className="w-3 h-3" /> Energia</p>
            <p className="text-lg font-bold text-goodwe-green tabular-nums">{session.kwh.toFixed(1)} kWh</p>
          </div>
          <div className="glass-card p-3">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Tempo decorrido</p>
            <p className="text-lg font-bold text-foreground tabular-nums">{session.elapsedMin} min</p>
          </div>
          <div className="glass-card p-3">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Custo</p>
            <p className="text-lg font-bold text-goodwe-orange tabular-nums">R$ {session.estimatedCost.toFixed(2).replace(".", ",")}</p>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center justify-between text-[11px] mb-2">
            <span className="text-muted-foreground">Previsão de conclusão</span>
            <span className="text-foreground font-semibold tabular-nums">{eta} · saída {session.departureTime}</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-goodwe-blue to-goodwe-green rounded-full transition-all duration-700" style={{ width: `${Math.min(100, session.currentPct)}%` }} />
          </div>
        </div>

        <button
          onClick={finish}
          className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm glow-red flex items-center justify-center gap-2"
        >
          <Square className="w-4 h-4" /> Finalizar Recarga
        </button>
      </div>
    </div>
  );
}
