import { ArrowLeft, QrCode, CreditCard, Zap, DollarSign, AlertTriangle, Clock } from "lucide-react";
import { useLiveData, statusMeta, modeMeta } from "@/components/dashboard/LiveDataProvider";

interface Props {
  chargerId: string | null;
  onBack: () => void;
  onNavigate: (screen: string) => void;
}

export function MobileChargerDetail({ chargerId, onBack, onNavigate }: Props) {
  const { chargers } = useLiveData();
  const charger = chargers.find((c) => c.id === chargerId) ?? chargers[0];
  const meta = statusMeta[charger.status];
  const busy = charger.status === "charging" || charger.status === "preparing";

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <div>
          <h2 className="text-base font-bold text-foreground">{charger.name}</h2>
          <p className="text-[10px] text-muted-foreground font-mono">{charger.id} · {charger.type}</p>
        </div>
      </div>

      <div className="flex-1 px-4 overflow-y-auto pb-6 space-y-3">
        <div className="glass-card p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Status atual</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">{charger.status === "faulted" ? "Manutenção" : meta.label}</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full font-medium border ${meta.cls}`}>
            <span className={`status-dot ${meta.dot}`} /> {meta.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="glass-card p-3">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3" /> Potência máxima</p>
            <p className="text-lg font-bold text-goodwe-blue tabular-nums">{charger.maxPower} kW</p>
          </div>
          <div className="glass-card p-3">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Tarifa</p>
            <p className="text-lg font-bold text-goodwe-orange tabular-nums">R$ {charger.tariff.toFixed(2).replace(".", ",")}</p>
            <p className="text-[9px] text-muted-foreground">por kWh</p>
          </div>
        </div>

        {busy && (
          <div className="glass-card p-4 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sessão em andamento</h3>
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground font-medium">{charger.user ?? "—"}</span>
              <span className="text-muted-foreground">{charger.vehicle ?? "—"}</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-goodwe-blue to-goodwe-green rounded-full transition-all duration-700" style={{ width: `${charger.pct}%` }} />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>{Math.round(charger.pct)}% carregado</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {charger.etaMin} min restantes</span>
            </div>
            <div className="flex items-center gap-2 pt-1">
              {charger.mode && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${modeMeta[charger.mode].cls}`}>
                  {modeMeta[charger.mode].emoji} {modeMeta[charger.mode].label}
                </span>
              )}
              {charger.departureTime && (
                <span className="text-[10px] text-muted-foreground">Saída prevista: {charger.departureTime}</span>
              )}
            </div>
          </div>
        )}

        {charger.status === "faulted" && (
          <div className="glass-card border-primary/30 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">Estação em manutenção</h3>
              <p className="text-xs text-muted-foreground mt-1">Comunicação OCPP perdida. Nossa equipe técnica já foi notificada.</p>
            </div>
          </div>
        )}

        {charger.status === "available" && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onNavigate("sessionSetup")}
              className="glass-card p-4 flex flex-col items-center gap-2 hover:border-primary/40 transition-all"
            >
              <QrCode className="w-6 h-6 text-primary" />
              <span className="text-xs font-semibold text-foreground">QR Code</span>
            </button>
            <button
              onClick={() => onNavigate("sessionSetup")}
              className="glass-card p-4 flex flex-col items-center gap-2 hover:border-goodwe-blue/40 transition-all"
            >
              <CreditCard className="w-6 h-6 text-goodwe-blue" />
              <span className="text-xs font-semibold text-foreground">RFID</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
