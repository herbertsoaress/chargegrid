import { useState, useMemo } from "react";
import { BarChart3, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Slider } from "@/components/ui/slider";

const INVESTMENT = 15000;

export function DashboardSimulator() {
  const [chargers, setChargers] = useState(8);
  const [building, setBuilding] = useState(120);
  const [limit, setLimit] = useState(200);
  const [vehicles, setVehicles] = useState(6);
  const [solar, setSolar] = useState(30);

  const peakWithout = Math.max(0, building + vehicles * 22 - solar);
  const peakWith = building + Math.max(0, Math.min(vehicles * 22, limit - building - solar - 10));
  const diff = Math.max(0, peakWithout - peakWith);
  const monthlySaving = diff * 50 * 22;
  const payback = monthlySaving > 0 ? INVESTMENT / monthlySaving : Infinity;
  const exceeds = peakWithout > limit;

  const roiData = useMemo(
    () => Array.from({ length: 24 }, (_, i) => ({ mes: `M${i + 1}`, acumulado: Math.round(monthlySaving * (i + 1)) })),
    [monthlySaving]
  );
  const breakEvenMonth = roiData.find((d) => d.acumulado >= INVESTMENT)?.mes ?? null;

  const sliders = [
    { label: "Nº de carregadores", value: chargers, set: setChargers, min: 4, max: 30, unit: "" },
    { label: "Consumo base do prédio", value: building, set: setBuilding, min: 50, max: 250, unit: " kW" },
    { label: "Limite contratado", value: limit, set: setLimit, min: 100, max: 400, unit: " kW" },
    { label: "Veículos simultâneos", value: vehicles, set: setVehicles, min: 1, max: 20, unit: "" },
    { label: "Geração solar", value: solar, set: setSolar, min: 0, max: 100, unit: " kW" },
  ];

  return (
    <div className="space-y-4 fade-in">
      <div className="glass-card-glow p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Simulador "E Se...?"</h3>
          <span className="ml-auto text-[10px] text-muted-foreground">cálculo em tempo real</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
          {sliders.map((s) => (
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
          <div className={`rounded-lg border p-4 ${exceeds ? "border-primary/50 bg-primary/5" : "border-white/5 bg-black/30"}`}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Sem ChargeGrid</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">{peakWithout} kW</p>
            <p className="text-[10px] text-muted-foreground mt-1">pico estimado de demanda</p>
            <span className={`mt-2 inline-block text-[10px] px-2 py-0.5 rounded-full border ${exceeds ? "bg-primary/15 text-primary border-primary/30" : "bg-goodwe-green/15 text-goodwe-green border-goodwe-green/30"}`}>
              {exceeds ? "⚠️ Ultrapassagem contratual" : "Dentro do limite"}
            </span>
          </div>
          <div className="rounded-lg border border-goodwe-green/50 bg-goodwe-green/5 p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Com ChargeGrid</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">{peakWith} kW</p>
            <p className="text-[10px] text-muted-foreground mt-1">pico com redistribuição inteligente</p>
            <span className="mt-2 inline-block text-[10px] px-2 py-0.5 rounded-full bg-goodwe-green/15 text-goodwe-green border border-goodwe-green/30">✅ Dentro do limite</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <div className="rounded-lg bg-black/30 border border-white/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Redução de pico</p>
            <p className="text-lg font-bold text-goodwe-blue tabular-nums">{diff} kW</p>
          </div>
          <div className="rounded-lg bg-black/30 border border-white/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Economia mensal</p>
            <p className="text-lg font-bold text-goodwe-green tabular-nums">R$ {monthlySaving.toLocaleString("pt-BR")}</p>
          </div>
          <div className="rounded-lg bg-black/30 border border-white/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Retorno do investimento</p>
            <p className="text-lg font-bold text-goodwe-orange tabular-nums">
              {isFinite(payback) ? `${payback < 1 ? payback.toFixed(1) : Math.ceil(payback)} ${payback < 1 ? "mês" : "meses"}` : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="glass-card card-hover p-4">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-4 h-4 text-goodwe-green" />
          <h3 className="text-sm font-semibold text-foreground">Projeção de ROI — 24 meses</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Economia acumulada vs investimento inicial de R$ {INVESTMENT.toLocaleString("pt-BR")}
          {breakEvenMonth ? ` · Ponto de retorno em ${breakEvenMonth}` : ""}
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={roiData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#999' }} />
            <YAxis tick={{ fontSize: 10, fill: '#999' }} />
            <Tooltip
              formatter={(v: number) => `R$ ${v.toLocaleString("pt-BR")}`}
              contentStyle={{ background: '#1F1F1F', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
            />
            <ReferenceLine y={INVESTMENT} stroke="#E60012" strokeDasharray="5 5" label={{ value: "Investimento inicial", fill: "#E60012", fontSize: 10 }} />
            {breakEvenMonth && (
              <ReferenceLine x={breakEvenMonth} stroke="#00AEEF" strokeDasharray="3 3" label={{ value: "Ponto de retorno ✓", fill: "#00AEEF", fontSize: 10 }} />
            )}
            <Line type="monotone" dataKey="acumulado" stroke="#4ADE80" strokeWidth={2} dot={false} name="Com ChargeGrid" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
