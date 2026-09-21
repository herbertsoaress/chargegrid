import { Zap, Users, DollarSign, Activity, TrendingUp, TrendingDown, Gauge, Timer } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ReferenceLine } from "recharts";
import { useLiveData, statusMeta, modeMeta } from "./LiveDataProvider";

const hourlyData = [
  { hour: "00h", kw: 12 }, { hour: "02h", kw: 8 }, { hour: "04h", kw: 5 },
  { hour: "06h", kw: 15 }, { hour: "08h", kw: 45 }, { hour: "10h", kw: 62 },
  { hour: "12h", kw: 78 }, { hour: "14h", kw: 55 }, { hour: "16h", kw: 68 },
  { hour: "18h", kw: 95 }, { hour: "20h", kw: 85 }, { hour: "22h", kw: 42 },
];

const weeklyRevenue = [
  { day: "Seg", value: 1250 }, { day: "Ter", value: 1480 },
  { day: "Qua", value: 1320 }, { day: "Qui", value: 1650 },
  { day: "Sex", value: 1890 }, { day: "Sáb", value: 2100 },
  { day: "Dom", value: 1750 },
];

export function DashboardOverview() {
  const { totals, chargers, load } = useLiveData();
  const availableCount = chargers.filter((c) => c.status === "available").length;
  const pct = totals.networkLoadPct;
  const barColor = pct > 90 ? "bg-primary" : pct >= 70 ? "bg-goodwe-orange" : "bg-goodwe-green";

  // Com operador logado, energia e faturamento de hoje vem do banco (sessoes encerradas hoje).
  const fromDb = totals.source === "banco";
  const dataTag = fromDb ? "banco" : "simulado";

  const stats = [
    { label: "Energia hoje", value: `${totals.kwhToday.toLocaleString("pt-BR")} kWh`, icon: Zap, trend: dataTag, up: true, color: "text-goodwe-blue", suffix: null as string | null, bar: false },
    { label: "Sessões ativas", value: `${totals.activeSessions}`, icon: Activity, trend: "carregadores", up: true, color: "text-goodwe-green", suffix: `(${availableCount} disponíveis)`, bar: false },
    { label: "Faturamento hoje", value: `R$ ${totals.revenueToday.toLocaleString("pt-BR", fromDb ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : undefined)}`, icon: DollarSign, trend: dataTag, up: true, color: "text-goodwe-orange", suffix: null, bar: false },
    { label: "Capacidade da rede", value: `${pct.toFixed(0)}%`, icon: Gauge, trend: `${totals.distributedPower} kW`, up: pct < 90, color: "text-primary", suffix: null, bar: true },
  ];

  const recent = chargers
    .filter((c) => c.status === "charging" || c.status === "finishing")
    .slice(0, 5);

  const upcoming = chargers.filter((c) => c.status === "charging" && c.etaMin <= 10);

  return (
    <div className="space-y-4 fade-in">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s, i) => (
          <div key={i} className="glass-card card-hover p-4">
            <div className="flex items-center justify-between mb-2">
              <s.icon className={`w-5 h-5 ${s.color}`} />
              <span className={`text-[10px] font-medium flex items-center gap-0.5 ${s.up ? "text-green-400" : "text-primary"}`}>
                {s.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {s.trend}
              </span>
            </div>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {s.value}
              {s.suffix && <span className="ml-1.5 text-[11px] font-medium text-muted-foreground/70">{s.suffix}</span>}
            </p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            {s.bar && (
              <div className="mt-2 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Live network load */}
      <div className="glass-card card-hover p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Potência distribuída em tempo real</h3>
            <p className="text-[11px] text-muted-foreground">Stream OCPP · janela 20 min · limite contratado {totals.networkLimit} kW</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-goodwe-blue tabular-nums">{totals.distributedPower} kW</p>
            <p className="text-[10px] text-muted-foreground">distribuídos agora</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={load}>
            <defs>
              <linearGradient id="liveLoad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00AEEF" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#00AEEF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#999' }} />
            <YAxis tick={{ fontSize: 10, fill: '#999' }} domain={[0, 220]} />
            <Tooltip contentStyle={{ background: '#1F1F1F', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
            <ReferenceLine y={totals.networkLimit} stroke="#E60012" strokeDasharray="4 4" />
            <Area type="monotone" dataKey="total" stroke="#00AEEF" fill="url(#liveLoad)" strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card card-hover p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Demanda de Potência (kW) <span className="ml-1 text-[10px] font-normal text-muted-foreground">exemplo ilustrativo</span></h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={hourlyData}>
              <defs>
                <linearGradient id="colorKw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00AEEF" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00AEEF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#999' }} />
              <YAxis tick={{ fontSize: 10, fill: '#999' }} />
              <Tooltip
                contentStyle={{ background: '#1F1F1F', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#fff' }}
              />
              <Area type="monotone" dataKey="kw" stroke="#00AEEF" fill="url(#colorKw)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card card-hover p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">Receita Semanal (R$) <span className="ml-1 text-[10px] font-normal text-muted-foreground">exemplo ilustrativo</span></h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weeklyRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#999' }} />
              <YAxis tick={{ fontSize: 10, fill: '#999' }} />
              <Tooltip
                contentStyle={{ background: '#1F1F1F', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="value" fill="#E60012" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent sessions */}
      <div className="glass-card card-hover p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Sessões em andamento</h3>
          <span className="text-[10px] text-goodwe-green flex items-center gap-1.5">
            <span className="status-dot text-goodwe-green" /> Tempo real
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-white/5">
                <th className="text-left py-2 font-medium">Usuário</th>
                <th className="text-left py-2 font-medium">Estação</th>
                <th className="text-left py-2 font-medium">Veículo</th>
                <th className="text-left py-2 font-medium">Modo</th>
                <th className="text-left py-2 font-medium">Potência</th>
                <th className="text-left py-2 font-medium">Progresso</th>
                <th className="text-left py-2 font-medium">ETA</th>
                <th className="text-left py-2 font-medium">Saída</th>
                <th className="text-left py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => {
                const meta = statusMeta[c.status];
                return (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02] transition">
                    <td className="py-2.5 text-foreground font-medium">{c.user ?? "—"}</td>
                    <td className="py-2.5 text-muted-foreground">{c.name} <span className="text-muted-foreground/50 font-mono">{c.id}</span></td>
                    <td className="py-2.5 text-muted-foreground">{c.vehicle ?? "—"}</td>
                    <td className="py-2.5">
                      {c.mode ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${modeMeta[c.mode].cls}`}>
                          {modeMeta[c.mode].emoji} {modeMeta[c.mode].label}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-goodwe-blue font-medium tabular-nums">{c.currentPower.toFixed(1)} kW</td>
                    <td className="py-2.5 w-40">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-goodwe-blue rounded-full transition-all duration-700" style={{ width: `${c.pct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right">{Math.round(c.pct)}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-muted-foreground tabular-nums">{c.etaMin} min</td>
                    <td className="py-2.5 text-muted-foreground tabular-nums">{c.departureTime ?? "—"}</td>
                    <td className="py-2.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${meta.cls}`}>
                        <span className={`status-dot ${meta.dot}`} /> {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Próximas liberações */}
      <div className="glass-card card-hover p-4">
        <div className="flex items-center gap-2 mb-3">
          <Timer className="w-4 h-4 text-goodwe-green" />
          <h3 className="text-sm font-semibold text-foreground">Próximas liberações</h3>
          <span className="text-[10px] text-muted-foreground ml-auto">estações livres em menos de 10 min</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma estação prevista para liberar nos próximos 10 minutos.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcoming.map((c) => (
              <div key={c.id} className="rounded-lg bg-black/30 border border-white/5 p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-foreground">{c.name}</p>
                  <span className="text-[10px] text-goodwe-green tabular-nums">~{c.etaMin} min</span>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2">{c.vehicle ?? "—"} · {c.user ?? "—"}</p>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-goodwe-blue to-goodwe-green rounded-full transition-all duration-700" style={{ width: `${c.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
