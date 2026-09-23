import { useMemo, useState } from "react";
import { ArrowLeft, Clock, BatteryCharging, Check } from "lucide-react";
import { toast } from "sonner";
import { useLiveData, ChargeMode, modeMeta } from "@/components/dashboard/LiveDataProvider";
import { estimateCharge, MODE_POWER_FACTOR } from "@/lib/pricing";

interface Props {
  chargerId: string | null;
  onBack: () => void;
  onStarted: () => void;
}

const BATTERY_KWH = 60; // capacidade média da frota simulada
const MODES: ChargeMode[] = ["rapido", "eco", "sustentavel", "garantido"];

export function MobileSessionSetup({ chargerId, onBack, onStarted }: Props) {
  const { chargers, startSession, forecast, backend, vehicles } = useLiveData();
  const charger = chargers.find((c) => c.id === chargerId) ?? chargers[0];

  const [departure, setDeparture] = useState("18:30");
  const [target, setTarget] = useState(80);
  const [mode, setMode] = useState<ChargeMode>("rapido");
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? vehicles[0];

  // Mesma conta que o backend usa para travar o preco na sessao (services/pricing.py + config.py):
  // energia x (preco do modelo + acrescimo do modo) + tempo de uso, com um teto por kWh entregue.
  const estimate = useMemo(() => {
    const startPct = 28;
    const needKwh = Math.max(1, ((target - startPct) / 100) * BATTERY_KWH);
    const power = Math.max(3, charger.maxPower * MODE_POWER_FACTOR[mode]);
    return estimateCharge(needKwh, power, mode, forecast.now.price);
  }, [target, mode, charger, forecast.now.price]);

  const confirm = () => {
    // "Maria Souza" -> "Maria S." (nomes completos nao aparecem em telas operacionais)
    const parts = (backend.driver?.name ?? "João Silva").split(" ");
    startSession(charger.id, {
      userName: parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0],
      vehicle: vehicle?.model ?? (backend.driver ? "Veículo" : "BYD Dolphin"),
      vehicleId: vehicle?.id,
      targetPct: target,
      departureTime: departure,
      priority: mode,
    });
    toast.success("Recarga iniciada", {
      description: `${charger.name} · modo ${modeMeta[mode].label} · meta ${target}% até ${departure}`,
    });
    onStarted();
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <div>
          <h2 className="text-base font-bold text-foreground">Configurar Recarga</h2>
          <p className="text-[10px] text-muted-foreground font-mono">{charger.id} · {charger.type}</p>
        </div>
      </div>

      <div className="flex-1 px-4 overflow-y-auto pb-6 space-y-3">
        {/* Vehicle (so quando ha mais de um cadastrado no perfil) */}
        {vehicles.length > 1 && (
          <div className="glass-card p-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Veículo</h3>
            <select
              value={vehicle?.id ?? ""}
              onChange={(e) => setVehicleId(Number(e.target.value))}
              aria-label="Veículo"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.model} · {v.plate}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Departure */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Horário de saída
          </h3>
          <input
            type="time"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-lg font-bold text-foreground tabular-nums outline-none focus:border-primary/50"
          />
        </div>

        {/* Target */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <BatteryCharging className="w-3.5 h-3.5" /> Nível desejado
            </h3>
            <span className="text-lg font-bold text-goodwe-blue tabular-nums">{target}%</span>
          </div>
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>20%</span><span>100%</span>
          </div>
        </div>

        {/* Modes */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Modo de carregamento</h3>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => {
              const meta = modeMeta[m];
              const active = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`text-left p-3 rounded-xl border transition-all ${active ? meta.cls : "bg-white/[0.02] border-white/5 text-muted-foreground hover:border-white/20"}`}
                >
                  <p className="text-sm font-semibold">{meta.emoji} {meta.label}</p>
                  <p className="text-[10px] opacity-80 mt-0.5 leading-tight">{meta.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Estimate */}
        <div className="glass-card-glow p-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[10px] text-muted-foreground">Tempo estimado</p>
            <p className="text-sm font-bold text-goodwe-orange">~{estimate.minutes} min</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Energia</p>
            <p className="text-sm font-bold text-goodwe-blue">{estimate.kwh.toFixed(1)} kWh</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Custo estimado</p>
            <p className="text-sm font-bold text-goodwe-green">R$ {estimate.total.toFixed(2).replace(".", ",")}</p>
          </div>
        </div>

        <div className="glass-card p-3 text-[10px] text-muted-foreground space-y-1">
          <p>
            Tarifa agora: <span className="text-foreground font-semibold">R$ {forecast.now.price.toFixed(2).replace(".", ",")}/kWh</span>
            {" "}· faixa {forecast.now.band}
            {estimate.energyPricePerKwh !== forecast.now.price && (
              <> · com o modo {modeMeta[mode].label}: <span className="text-foreground font-semibold">R$ {estimate.energyPricePerKwh.toFixed(2).replace(".", ",")}/kWh</span></>
            )}
          </p>
          <div className="flex items-center justify-between pt-1 border-t border-white/5">
            <span>Energia ({estimate.kwh.toFixed(1)} kWh)</span>
            <span className="text-foreground">R$ {estimate.energyAmount.toFixed(2).replace(".", ",")}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Tempo de uso (~{estimate.minutes} min)</span>
            <span className="text-foreground">R$ {estimate.timeAmount.toFixed(2).replace(".", ",")}</span>
          </div>
          <p>
            Ocupação prevista da rede: {Math.round(forecast.now.occupancyUsed * 100)}% · {forecast.modelLabel}. O preço fica travado ao iniciar a recarga.
            Quanto mais potente o modo, maior o preço do kWh; quanto mais tempo o carro fica no carregador, mais a tarifa de tempo pesa.
          </p>
          {mode !== "rapido" && backend.ocppSimulator && (
            <p className="pt-1 border-t border-white/5 text-goodwe-blue">
              ⚡ Este modo segue um plano de potência (Energy Autopilot) até {departure}, olhando preço e energia solar previstos — veja o resultado na tela da recarga.
            </p>
          )}
        </div>

        <button
          onClick={confirm}
          className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm glow-red flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4" /> Confirmar e Iniciar Recarga
        </button>
      </div>
    </div>
  );
}
