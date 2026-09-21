import { useEffect, useState } from "react";
import { Users, Building, Car } from "lucide-react";
import { backend as api } from "@/lib/backend/client";
import { formatBrl } from "@/lib/backend/mappers";
import { useLiveData } from "./LiveDataProvider";

type Row = {
  name: string;
  email: string;
  type: string;
  vehicle: string;
  sessions: number;
  total: string;
  status: string;
};

// Exemplo usado na simulacao local (sem backend).
const sampleUsers: Row[] = [
  { name: "João Silva", email: "joao@email.com", type: "Individual", vehicle: "BYD Dolphin", sessions: 12, total: "R$ 458,20", status: "Ativo" },
  { name: "Maria Lima", email: "maria@corp.com", type: "Corporativo", vehicle: "Tesla Model 3", sessions: 8, total: "R$ 312,50", status: "Ativo" },
  { name: "Carlos Ribeiro", email: "carlos@empresa.com", type: "Corporativo", vehicle: "Volvo XC40", sessions: 15, total: "R$ 682,10", status: "Ativo" },
  { name: "Ana Paula", email: "ana@email.com", type: "Individual", vehicle: "GWM Ora 03", sessions: 6, total: "R$ 198,40", status: "Inativo" },
  { name: "Empresa XYZ Ltda", email: "frota@xyz.com", type: "Frota", vehicle: "10 veículos", sessions: 45, total: "R$ 3.250,00", status: "Ativo" },
];

const typeStyles: Record<string, string> = {
  Individual: "bg-goodwe-blue/20 text-goodwe-blue",
  Corporativo: "bg-primary/20 text-primary",
  Frota: "bg-green-500/20 text-green-400",
  Motorista: "bg-goodwe-blue/20 text-goodwe-blue",
};

export function DashboardUsers() {
  const { backend } = useLiveData();
  const [rows, setRows] = useState<Row[] | null>(null); // null = usar exemplo (sem banco)

  useEffect(() => {
    if (backend.status !== "online" || !backend.operatorToken) return;
    let cancelled = false;
    api
      .users(backend.operatorToken)
      .then((users) => {
        if (cancelled) return;
        setRows(
          users.map((u) => ({
            name: u.name,
            email: u.email,
            type: "Motorista",
            vehicle: u.vehicles.length ? u.vehicles.map((v) => v.model).join(", ") : "—",
            sessions: u.total_sessions,
            total: formatBrl(u.total_spent),
            status: u.total_sessions > 0 ? "Ativo" : "Sem sessões",
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setRows(null); // falha: volta ao exemplo local
      });
    return () => {
      cancelled = true;
    };
  }, [backend.status, backend.operatorToken]);

  const fromDatabase = rows !== null;
  const users = rows ?? sampleUsers;
  const vehicleCount = fromDatabase ? users.filter((u) => u.vehicle !== "—").length : 178;

  return (
    <div className="space-y-4 fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {[
          { label: "Total de Usuários", value: fromDatabase ? String(users.length) : "156", icon: Users, color: "text-goodwe-blue" },
          fromDatabase
            ? { label: "Sessões registradas", value: String(users.reduce((s, u) => s + u.sessions, 0)), icon: Building, color: "text-goodwe-orange" }
            : { label: "Empresas / Frotas", value: "12", icon: Building, color: "text-goodwe-orange" },
          { label: fromDatabase ? "Motoristas com veículo" : "Veículos Cadastrados", value: String(vehicleCount), icon: Car, color: "text-green-400" },
        ].map((s, i) => (
          <div key={i} className="glass-card-glow p-4">
            <s.icon className={`w-5 h-5 mb-2 ${s.color}`} />
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Gestão de Usuários</h3>
          <span className="text-[10px] text-muted-foreground">
            {fromDatabase ? "Dados reais do banco" : "Dados de exemplo (simulação local)"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-white/5">
                <th className="text-left py-2 font-medium">Nome</th>
                <th className="text-left py-2 font-medium">Tipo</th>
                <th className="text-left py-2 font-medium">Veículo</th>
                <th className="text-left py-2 font-medium">Sessões</th>
                <th className="text-left py-2 font-medium">Total Gasto</th>
                <th className="text-left py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email} className="border-b border-white/5">
                  <td className="py-2.5">
                    <p className="text-foreground font-medium">{u.name}</p>
                    <p className="text-muted-foreground text-[10px]">{u.email}</p>
                  </td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${typeStyles[u.type]}`}>{u.type}</span>
                  </td>
                  <td className="py-2.5 text-muted-foreground">{u.vehicle}</td>
                  <td className="py-2.5 text-foreground">{u.sessions}</td>
                  <td className="py-2.5 text-foreground font-medium">{u.total}</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      u.status === "Ativo" ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"
                    }`}>{u.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
