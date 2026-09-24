import { Link } from "react-router-dom";
import { Zap, ArrowLeft, DollarSign, BatteryCharging, Activity, Gauge } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const kpis = [
  { label: "Faturamento do dia", value: "R$ 4.281,90", icon: DollarSign, accent: "text-goodwe-green" },
  { label: "Energia total", value: "1.987 kWh", icon: BatteryCharging, accent: "text-goodwe-blue" },
  { label: "Sessões ativas", value: "12", icon: Activity, accent: "text-goodwe-orange" },
  { label: "Taxa de ocupação", value: "78%", icon: Gauge, accent: "text-primary" },
];

const stations = [
  { id: "EST-01", name: "FIAP #1", power: 150, busy: true },
  { id: "EST-02", name: "FIAP #2", power: 150, busy: false },
  { id: "EST-03", name: "FIAP #3", power: 22, busy: true },
  { id: "EST-04", name: "FIAP #5", power: 50, busy: true },
  { id: "EST-05", name: "FIAP #6", power: 50, busy: false },
  { id: "EST-06", name: "FIAP #7", power: 150, busy: true },
  { id: "EST-07", name: "FIAP #8", power: 22, busy: true },
  { id: "EST-08", name: "Morumbi #1", power: 50, busy: false },
];

const liveSessions = [
  { user: "João S.", station: "FIAP #1", power: 47, kwh: 18.2, soc: 68 },
  { user: "Carlos R.", station: "FIAP #3", power: 18.5, kwh: 9.4, soc: 42 },
  { user: "Maria L.", station: "FIAP #5", power: 38.7, kwh: 22.1, soc: 85 },
  { user: "Ana P.", station: "FIAP #7", power: 110, kwh: 31.6, soc: 31 },
  { user: "Ricardo M.", station: "FIAP #8", power: 7.4, kwh: 14.0, soc: 98 },
];

const hourlyRevenue = [
  { h: "08h", r: 120 }, { h: "09h", r: 220 }, { h: "10h", r: 340 },
  { h: "11h", r: 410 }, { h: "12h", r: 380 }, { h: "13h", r: 450 },
  { h: "14h", r: 520 }, { h: "15h", r: 610 }, { h: "16h", r: 580 },
  { h: "17h", r: 720 }, { h: "18h", r: 680 }, { h: "19h", r: 451 },
];

const closedSessions = [
  { id: "SES-1021", user: "Pedro A.", kwh: 42.1, idle: 6, cost: 90.52 },
  { id: "SES-1020", user: "Bruna T.", kwh: 28.7, idle: 12, cost: 61.71 },
  { id: "SES-1019", user: "Felipe N.", kwh: 51.4, idle: 3, cost: 110.51 },
  { id: "SES-1018", user: "Camila V.", kwh: 19.2, idle: 18, cost: 41.28 },
  { id: "SES-1017", user: "Lucas T.", kwh: 33.8, idle: 8, cost: 72.67 },
];

export default function DashboardEstacoes() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-white/5 px-4 lg:px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center glow-red">
            <Zap className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground">Dashboard de Estações</h1>
            <p className="text-[10px] text-muted-foreground">Monitoramento em tempo real</p>
          </div>
        </Link>
        <Link to="/" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">
        {/* KPIs */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="glass-card rounded-xl p-4 border border-white/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-muted-foreground">{k.label}</span>
                <k.icon className={`w-4 h-4 ${k.accent}`} />
              </div>
              <p className="text-xl font-bold text-foreground">{k.value}</p>
            </div>
          ))}
        </section>

        {/* Stations */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Estações</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {stations.map((s) => (
              <div key={s.id} className="glass-card rounded-xl p-4 border border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-foreground">{s.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{s.id}</span>
                </div>
                <p className="text-lg font-bold text-foreground mb-2">{s.power} <span className="text-xs font-normal text-muted-foreground">kW</span></p>
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  s.busy
                    ? "bg-goodwe-blue/15 text-goodwe-blue border-goodwe-blue/30"
                    : "bg-goodwe-green/15 text-goodwe-green border-goodwe-green/30"
                }`}>
                  {s.busy ? "🟢 OCUPADA" : "⚪ LIVRE"}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Live sessions */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Carregamento em tempo real</h2>
          <div className="glass-card rounded-xl border border-white/5 divide-y divide-white/5">
            {liveSessions.map((s, i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <div className="w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                  {s.user.split(" ").map((n) => n[0]).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-xs font-semibold text-foreground truncate">{s.user} <span className="text-muted-foreground font-normal">· {s.station}</span></p>
                    <span className="text-[10px] font-mono text-goodwe-blue">{s.power} kW · {s.kwh} kWh</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-goodwe-blue to-goodwe-green transition-all duration-700"
                        style={{ width: `${s.soc}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground w-10 text-right">{s.soc}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Billing report */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="glass-card rounded-xl p-4 border border-white/5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Faturamento por hora</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyRevenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="h" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`R$ ${v}`, "Faturamento"]}
                  />
                  <Bar dataKey="r" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass-card rounded-xl p-4 border border-white/5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Sessões encerradas</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-white/5">
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 pr-3">Usuário</th>
                    <th className="py-2 pr-3 text-right">kWh</th>
                    <th className="py-2 pr-3 text-right">Ocioso</th>
                    <th className="py-2 text-right">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {closedSessions.map((s) => (
                    <tr key={s.id} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3 font-mono text-muted-foreground">{s.id}</td>
                      <td className="py-2 pr-3 text-foreground">{s.user}</td>
                      <td className="py-2 pr-3 text-right text-goodwe-blue font-mono">{s.kwh}</td>
                      <td className="py-2 pr-3 text-right text-muted-foreground font-mono">{s.idle} min</td>
                      <td className="py-2 text-right text-goodwe-green font-mono">R$ {s.cost.toFixed(2).replace(".", ",")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
