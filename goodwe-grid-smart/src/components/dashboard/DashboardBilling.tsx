import { Receipt, TrendingUp, CreditCard, Smartphone } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DashboardBackend } from "./DashboardBackend";

const monthlyRevenue = [
  { month: "Jan", revenue: 12500 }, { month: "Fev", revenue: 14200 },
  { month: "Mar", revenue: 16800 }, { month: "Abr", revenue: 18500 },
];

const invoices = [
  { id: "INV-2026-041", client: "Shopping Iguatemi", amount: "R$ 4.520,00", status: "Pago", method: "PIX" },
  { id: "INV-2026-040", client: "Mercado Paulista", amount: "R$ 2.180,00", status: "Pendente", method: "Boleto" },
  { id: "INV-2026-039", client: "Posto BR Paulista", amount: "R$ 6.890,00", status: "Pago", method: "PIX" },
  { id: "INV-2026-038", client: "Estac. GoodWe Centro", amount: "R$ 8.350,00", status: "Pago", method: "Cartão" },
];

export function DashboardBilling() {
  return (
    <div className="space-y-4 fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {[
          { label: "Receita Mensal", value: "R$ 18.500", icon: TrendingUp, color: "text-green-400" },
          { label: "Pagamentos PIX", value: "68%", icon: Smartphone, color: "text-goodwe-blue" },
          { label: "Faturas Pendentes", value: "3", icon: Receipt, color: "text-goodwe-orange" },
        ].map((s, i) => (
          <div key={i} className="glass-card-glow p-4">
            <s.icon className={`w-5 h-5 mb-2 ${s.color}`} />
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-4">Receita Mensal (R$)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyRevenue}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#999' }} />
            <YAxis tick={{ fontSize: 10, fill: '#999' }} />
            <Tooltip contentStyle={{ background: '#1F1F1F', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="revenue" fill="#E60012" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          Faturas Recentes <span className="ml-1 text-[10px] font-normal text-muted-foreground">(dados de exemplo)</span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-white/5">
                <th className="text-left py-2 font-medium">Nº Fatura</th>
                <th className="text-left py-2 font-medium">Cliente</th>
                <th className="text-left py-2 font-medium">Valor</th>
                <th className="text-left py-2 font-medium">Método</th>
                <th className="text-left py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-2.5 text-foreground font-mono">{inv.id}</td>
                  <td className="py-2.5 text-muted-foreground">{inv.client}</td>
                  <td className="py-2.5 text-foreground font-medium">{inv.amount}</td>
                  <td className="py-2.5 text-muted-foreground">{inv.method}</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      inv.status === "Pago" ? "bg-green-500/20 text-green-400" : "bg-goodwe-orange/20 text-goodwe-orange"
                    }`}>{inv.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <DashboardBackend only="invoices" />

      {/* Revenue split */}
      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Split de Receita</h3>
        <div className="space-y-2">
          {[
            { label: "Operador (GoodWe)", pct: 60, value: "R$ 11.100" },
            { label: "Proprietário do local", pct: 30, value: "R$ 5.550" },
            { label: "Taxa de plataforma", pct: 10, value: "R$ 1.850" },
          ].map((s, i) => (
            <div key={i}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="text-foreground font-medium">{s.value} ({s.pct}%)</span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${s.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
