import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { UserFleet } from "@/lib/types";

export function UsersFleets() {
  const [users, setUsers] = useState<UserFleet[]>([]);

  useEffect(() => {
    api.listUsersAndFleets().then(setUsers).catch(() => setUsers([]));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios e Frotas</h1>
        <p className="text-sm text-white/50">Motoristas cadastrados e veiculos vinculados</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-white/40">
                <th className="p-4 font-medium">Motorista</th>
                <th className="p-4 font-medium">E-mail</th>
                <th className="p-4 font-medium">Veiculos</th>
                <th className="p-4 font-medium">Sessoes</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-white/40">
                    Nenhum motorista cadastrado ainda
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="border-t border-white/10">
                  <td className="p-4">{u.name}</td>
                  <td className="p-4 text-white/60">{u.email}</td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1">
                      {u.vehicles.map((v) => (
                        <Badge key={v.id} variant="outline">
                          {v.plate} - {v.model}
                        </Badge>
                      ))}
                      {u.vehicles.length === 0 && <span className="text-white/30">Sem veiculo</span>}
                    </div>
                  </td>
                  <td className="p-4">{u.total_sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
