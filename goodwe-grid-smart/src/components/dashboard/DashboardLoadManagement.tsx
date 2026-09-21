import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Zap, Cpu, Brain, SlidersHorizontal } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Slider } from "@/components/ui/slider";
import { useLiveData, statusMeta, modeMeta } from "./LiveDataProvider";
import { DashboardMeter } from "./DashboardMeter";

function powerColor(pct: number) {
  return pct > 90 ? "bg-primary" : pct >= 70 ? "bg-goodwe-orange" : "bg-goodwe-green";
}

export function DashboardLoadManagement() {
  const { load, chargers, totals, applyPeakShaving, peakShavingActive } = useLiveData();
  const charging = chargers.filter((c) => c.status === "charging" || c.status === "preparing");
  const totalDemand = charging.reduce((s, c) => s + c.currentPower, 0) || 1;
  const nearLimit = totals.networkLoadPct > 85;

  const [simChargers, setSimChargers] = useState(8);
  const [simBuilding, setSimBuilding] = useState(120);
  const [simLimit, setSimLimit] = useState(200);

  const peakWithout = simBuilding + simChargers * 22;
  const peakWith = simBuilding + Math.max(0, Math.min(simChargers * 22, simLimit - simBuilding - 10));
  const diff = Math.max(0, peakWithout - peakWith);
  const saving = diff * 50;

  const handleShaving = () => {
    applyPeakShaving();
    toast.success("Peak Shaving ativado", { description: "Reduzindo potência dos carregadores em modo Eco para 60% por 30s." });
  };

  return (
    <div className="space-y-4 fade-in">
      {/* Medidor de energia do local (MODBUS TCP, simulado) */}
      <DashboardMeter />

      {/* Alert */}
      {nearLimit && (
        <div className="glass-card card-hover border-goodwe-orange/30 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-goodwe-orange mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">Peak Shaving recomendado</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Demanda em <span className="text-goodwe-orange font-semibold">{totals.distributedPower} kW</span> ({totals.networkLoadPct.toFixed(0)}% do limite de {totals.networkLimit} kW). Reduzir potência dos carregadores em 15% evita multa contratual.
            </p>
            <button className="mt-2 text-xs font-semibold text-primary hover:underline">Aplicar redução automática →</button>
          </div>
        </div>
      )}

      {/* Algorithm card */}
      <div className="glass-card card-hover p-4">
        <div className="flex items-center gap-2 mb-3">
          <Cpu className="w-4 h-4 text-goodwe-green" />
          <h3 className="text-sm font-semibold text-foreground">Algoritmo de Balanceamento Dinâmico (DLB)</h3>
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-goodwe-green/15 text-goodwe-green border border-goodwe-green/30">
            weighted round-robin · O(n log n)
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Distribuição proporcional da capacidade disponível entre veículos conectados, respeitando prioridade da fila e teto contratado.
        </p>
        <div className="space-y-2">
          {charging.map((c) => {
            const share = (c.currentPower / totalDemand) * 100;
            return (
              <div key={c.id} className="text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-2 text-foreground">
                    <span className="font-mono text-muted-foreground/70">{c.id}</span>
                    <span>{c.vehicle ?? "—"}</span>
                  </span>
                  <span className="tabular-nums text-goodwe-blue font-semibold">{c.currentPower.toFixed(1)} kW</span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                  <div
                    className="bg-gradient-to-r from-goodwe-blue to-goodwe-green transition-all duration-700"
                    style={{ width: `${share}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Energy Engine */}
      <div className="glass-card-glow p-4">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Energy Engine — Decisão atual</h3>
          {peakShavingActive && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-goodwe-orange/15 text-goodwe-orange border border-goodwe-orange/30 font-medium">
              <span className="status-dot text-goodwe-orange" /> Peak Shaving Ativo
            </span>
          )}
        </div>
        <div className="space-y-3">
          {charging.map((c) => {
            const usage = (c.currentPower / c.maxPower) * 100;
            return (
              <div key={c.id} className="text-xs">
                <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                  <span className="flex items-center gap-2 text-foreground">
                    <span className="font-mono text-muted-foreground/70">{c.id}</span>
                    <span>{c.name}</span>
                    {c.mode && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${modeMeta[c.mode].cls}`}>
                        {modeMeta[c.mode].emoji} {modeMeta[c.mode].label}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground">Saída {c.departureTime ?? "—"}</span>
                    <span className="tabular-nums text-goodwe-blue font-semibold">{c.currentPower.toFixed(1)} / {c.maxPower} kW</span>
                  </span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${powerColor(usage)}`} style={{ width: `${Math.min(100, usage)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-muted-foreground">
            Total distribuído:{" "}
            <span className={`font-semibold tabular-nums ${totals.networkLoadPct > 90 ? "text-primary" : totals.networkLoadPct >= 70 ? "text-goodwe-orange" : "text-goodwe-green"}`}>
              {totals.distributedPower} kW
            </span>{" "}
            / {totals.networkLimit} kW ({totals.networkLoadPct.toFixed(0)}%)
          </p>
          {nearLimit && (
            <button
              onClick={handleShaving}
              disabled={peakShavingActive}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition disabled:opacity-50"
            >
              {peakShavingActive ? "Peak Shaving Ativo ✓" : "Aplicar Peak Shaving Automático"}
            </button>
          )}
        </div>
      </div>

      {/* Simulador de Infraestrutura */}
      <div className="glass-card card-hover p-4">
        <div className="flex items-center gap-2 mb-4">
          <SlidersHorizontal className="w-4 h-4 text-goodwe-blue" />
          <h3 className="text-sm font-semibold text-foreground">Simulador de Infraestrutura</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {[
            { label: "Nº de carregadores", value: simChargers, set: setSimChargers, min: 4, max: 20, unit: "" },
            { label: "Consumo do prédio", value: simBuilding, set: setSimBuilding, min: 50, max: 200, unit: " kW" },
            { label: "Limite contratado", value: simLimit, set: setSimLimit, min: 100, max: 300, unit: " kW" },
          ].map((s) => (
            <div key={s.label}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-xs font-semibold text-foreground tabular-nums">{s.value}{s.unit}</p>
              </div>
              <Slider value={[s.value]} min={s.min} max={s.max} step={1} onValueChange={(v) => s.set(v[0])} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className={`rounded-lg border p-3 ${peakWithout > simLimit ? "border-primary/40 bg-primary/5" : "border-white/5 bg-black/30"}`}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Sem ChargeGrid</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{peakWithout} kW</p>
            {peakWithout > simLimit ? (
              <span className="mt-2 inline-block text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">⚠️ Ultrapassagem contratual</span>
            ) : (
              <span className="mt-2 inline-block text-[10px] px-2 py-0.5 rounded-full bg-goodwe-green/15 text-goodwe-green border border-goodwe-green/30">Dentro do limite</span>
            )}
          </div>
          <div className="rounded-lg border border-goodwe-green/40 bg-goodwe-green/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Com ChargeGrid</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{peakWith} kW</p>
            <span className="mt-2 inline-block text-[10px] px-2 py-0.5 rounded-full bg-goodwe-green/15 text-goodwe-green border border-goodwe-green/30">✅ Dentro do limite</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Redução de pico: <span className="text-goodwe-blue font-semibold tabular-nums">{diff} kW</span> · Economia estimada:{" "}
          <span className="text-goodwe-green font-semibold tabular-nums">R$ {saving.toLocaleString("pt-BR")}</span> (R$ 50/kW de ultrapassagem)
        </p>
      </div>

      {/* DLB Chart */}
      <div className="glass-card card-hover p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Dynamic Load Balancing</h3>
          <span className="text-[10px] bg-goodwe-blue/20 text-goodwe-blue px-2 py-0.5 rounded-full font-medium flex items-center gap-1.5">
            <span className="status-dot text-goodwe-blue" /> Tempo real
          </span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={load}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#999' }} />
            <YAxis tick={{ fontSize: 10, fill: '#999' }} domain={[0, 220]} />
            <Tooltip
              contentStyle={{ background: '#1F1F1F', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
            />
            <ReferenceLine y={totals.networkLimit} stroke="#E60012" strokeDasharray="5 5" label={{ value: `Limite ${totals.networkLimit}kW`, fill: '#E60012', fontSize: 10 }} />
            <Line type="monotone" dataKey="total" stroke="#00AEEF" strokeWidth={2} dot={false} name="Carga Total" isAnimationActive={false} />
            <Line type="monotone" dataKey="ev" stroke="#FF7759" strokeWidth={2} dot={false} name="Carga EV" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Balancing status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {[
          { label: "Carga total", value: `${totals.distributedPower} kW`, max: `${totals.networkLimit} kW`, pct: totals.networkLoadPct, color: "bg-goodwe-blue" },
          { label: "Veículos conectados", value: `${charging.length}`, max: `${chargers.length} estações`, pct: (charging.length / chargers.length) * 100, color: "bg-goodwe-orange" },
          { label: "Capacidade livre", value: `${Math.max(0, totals.networkLimit - totals.distributedPower).toFixed(1)} kW`, max: `${totals.networkLimit} kW`, pct: Math.max(0, 100 - totals.networkLoadPct), color: "bg-goodwe-green" },
        ].map((item, i) => (
          <div key={i} className="glass-card card-hover p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.max}</p>
            </div>
            <p className="text-xl font-bold text-foreground mb-2 tabular-nums">{item.value}</p>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-700 ${item.color}`} style={{ width: `${item.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
