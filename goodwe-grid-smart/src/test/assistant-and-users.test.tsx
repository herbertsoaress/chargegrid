import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/backend/config", () => ({
  API_URL: "http://api.test",
  get backendEnabled() {
    return flags.enabled;
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { LiveDataProvider, useLiveData } from "@/components/dashboard/LiveDataProvider";
import { DashboardUsers } from "@/components/dashboard/DashboardUsers";
import { useAssistantChat, type ChatMsg } from "@/components/ai/useAssistantChat";

type Chat = { messages: ChatMsg[]; send: (text: string) => void; online: boolean; loginDemo: ReturnType<typeof useLiveData>["loginDemo"] };
let chat: Chat;

function ChatProbe({ role }: { role: "driver" | "operator" }) {
  const { messages, send } = useAssistantChat(role, "Oi! Sou o assistente.");
  const { backend, loginDemo } = useLiveData();
  chat = { messages, send, online: backend.status === "online", loginDemo };
  return null;
}

/** Entra sozinho como demonstracao assim que a API responde (o app real pede login ao usuario). */
function AutoLogin({ role }: { role: "driver" | "operator" }) {
  const { backend, loginDemo } = useLiveData();
  useEffect(() => {
    if (backend.status === "online" && !backend[role]) void loginDemo(role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend.status]);
  return null;
}

type Reply = { status?: number; body: unknown };
let assistantReply: Reply = { body: { answer: "x", category: "geral", origem: "regras", modelo: null } };
let assistantCalls: { token: string; body: Record<string, unknown> }[] = [];

const usersPayload = [
  { id: 1, name: "Maria Souza", email: "maria@example.com", vehicles: [{ id: 1, plate: "ABC1D23", model: "BYD Dolphin" }], total_sessions: 3, total_spent: 12.5 },
  { id: 2, name: "Pedro Lima", email: "pedro@example.com", vehicles: [], total_sessions: 0, total_spent: 0 },
];

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace("http://api.test", "");
      const auth = (init.headers as Record<string, string>)?.Authorization ?? "";
      const body = init.body ? JSON.parse(init.body as string) : {};
      const reply = (status: number, payload: unknown) => ({
        ok: status < 400,
        status,
        statusText: "x",
        json: async () => payload,
      });

      if (path === "/auth/demo-login") return reply(200, { access_token: `tok-${body.role}`, role: body.role, name: "x", user_id: 1 });
      if (path === "/auth/me") {
        const role = auth.replace("Bearer tok-", "");
        return reply(200, { id: role === "operator" ? 2 : 1, name: "Conta Teste", email: `${role}@chargegrid.demo`, role });
      }
      if (path === "/vehicles/me") return reply(200, []);
      if (path === "/health")
        return reply(200, { status: "ok", version: "0.2.0", env: "development", database: { ok: true, engine: "postgresql" }, goodwe: { origem: "simulado" } });
      if (path === "/stations") return reply(200, [{ id: 1, name: "FIAP Paulista", type: "comercial", chargers: [{ id: 2, code: "CG-002", name: "FIAP #2" }] }]);
      if (path.startsWith("/sessions?")) return reply(200, []);
      if (path === "/users") return reply(200, usersPayload);
      if (path === "/assistant/query") {
        assistantCalls.push({ token: auth.replace("Bearer ", ""), body });
        return reply(assistantReply.status ?? 200, assistantReply.body);
      }
      return reply(404, { detail: "rota nao mockada" });
    }),
  );
}

const lastAssistantText = () => chat.messages.filter((m) => m.role === "assistant").at(-1);

beforeEach(() => {
  assistantCalls = [];
  assistantReply = { body: { answer: "x", category: "geral", origem: "regras", modelo: null } };
});
afterEach(() => vi.unstubAllGlobals());

describe("assistente de chat", () => {
  it("sem backend responde localmente e nao chama a API", async () => {
    flags.enabled = false;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <LiveDataProvider>
        <ChatProbe role="driver" />
      </LiveDataProvider>,
    );

    act(() => chat.send("Quanto vai custar?"));
    await waitFor(() => expect(chat.messages).toHaveLength(3), { timeout: 4000 });

    expect(lastAssistantText()?.text).toMatch(/tarifas variam/i);
    expect(lastAssistantText()?.origem).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a resposta sobre a carga da rede mostra o percentual arredondado", async () => {
    flags.enabled = false;
    vi.stubGlobal("fetch", vi.fn());
    render(
      <LiveDataProvider>
        <ChatProbe role="operator" />
      </LiveDataProvider>,
    );
    act(() => chat.send("Como está a carga da rede?"));
    await waitFor(() => expect(chat.messages).toHaveLength(3), { timeout: 4000 });
    expect(lastAssistantText()?.text).toMatch(/A rede está em \*\*\d{1,3}%\*\*/);
  });

  it("com backend usa a resposta da IA, manda historico (sem a saudacao) e o token do papel certo", async () => {
    flags.enabled = true;
    installFetch();
    assistantReply = { body: { answer: "Resposta do Gemini", category: "geral", origem: "ia", modelo: "gemini-2.5-flash" } };
    render(
      <LiveDataProvider>
        <ChatProbe role="operator" />
        <AutoLogin role="operator" />
      </LiveDataProvider>,
    );
    await waitFor(() => expect(chat.online).toBe(true));
    await new Promise((r) => setTimeout(r, 50)); // deixa o login de demonstracao terminar

    act(() => chat.send("Faturamento de hoje"));
    await waitFor(() => expect(lastAssistantText()?.text).toBe("Resposta do Gemini"), { timeout: 4000 });
    expect(lastAssistantText()?.origem).toBe("ia");

    act(() => chat.send("e as sessões?"));
    await waitFor(() => expect(assistantCalls).toHaveLength(2), { timeout: 4000 });

    const [first, second] = assistantCalls;
    expect(first.token).toBe("tok-operator");
    expect(first.body.question).toBe("Faturamento de hoje");
    expect(first.body.history).toEqual([]); // a saudacao nao entra
    expect(String(first.body.screen_snapshot)).toContain("CG-002");
    expect(second.body.history).toEqual([
      { role: "user", text: "Faturamento de hoje" },
      { role: "assistant", text: "Resposta do Gemini" },
    ]);
  });

  it("motorista pergunta com o token de motorista", async () => {
    flags.enabled = true;
    installFetch();
    render(
      <LiveDataProvider>
        <ChatProbe role="driver" />
        <AutoLogin role="driver" />
      </LiveDataProvider>,
    );
    await waitFor(() => expect(chat.online).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    act(() => chat.send("status da minha recarga"));
    await waitFor(() => expect(assistantCalls).toHaveLength(1), { timeout: 4000 });
    expect(assistantCalls[0].token).toBe("tok-driver");
  });

  it("se o backend respondeu so por regras, mantem a resposta local (coerente com a tela)", async () => {
    flags.enabled = true;
    installFetch();
    assistantReply = { body: { answer: "Nenhuma sessao no banco", category: "sessoes", origem: "regras", modelo: null } };
    render(
      <LiveDataProvider>
        <ChatProbe role="operator" />
        <AutoLogin role="operator" />
      </LiveDataProvider>,
    );
    await waitFor(() => expect(chat.online).toBe(true));
    await new Promise((r) => setTimeout(r, 50));

    act(() => chat.send("Sessões ativas agora"));
    await waitFor(() => expect(chat.messages).toHaveLength(3), { timeout: 4000 });
    expect(lastAssistantText()?.text).not.toContain("Nenhuma sessao no banco");
    expect(lastAssistantText()?.origem).toBeUndefined();
  });

  it("se a API falhar (500), responde localmente sem quebrar", async () => {
    flags.enabled = true;
    installFetch();
    assistantReply = { status: 500, body: { detail: "erro" } };
    render(
      <LiveDataProvider>
        <ChatProbe role="driver" />
        <AutoLogin role="driver" />
      </LiveDataProvider>,
    );
    await waitFor(() => expect(chat.online).toBe(true));
    await new Promise((r) => setTimeout(r, 50));

    act(() => chat.send("Quanto vai custar?"));
    await waitFor(() => expect(chat.messages).toHaveLength(3), { timeout: 4000 });
    expect(lastAssistantText()?.text).toMatch(/tarifas variam/i);
  });

  it("sem login o assistente nem chama a API: responde localmente", async () => {
    flags.enabled = true;
    installFetch();
    render(
      <LiveDataProvider>
        <ChatProbe role="driver" />
      </LiveDataProvider>,
    );
    await waitFor(() => expect(chat.online).toBe(true));
    act(() => chat.send("Quanto vai custar?"));
    await waitFor(() => expect(chat.messages).toHaveLength(3), { timeout: 4000 });
    expect(assistantCalls).toHaveLength(0);
    expect(lastAssistantText()?.text).toMatch(/tarifas variam/i);
  });
});

describe("Usuários & Frotas", () => {
  it("sem backend mostra os dados de exemplo", () => {
    flags.enabled = false;
    render(
      <LiveDataProvider>
        <DashboardUsers />
      </LiveDataProvider>,
    );
    expect(screen.getByText("Dados de exemplo (simulação local)")).toBeInTheDocument();
    expect(screen.getByText("Empresa XYZ Ltda")).toBeInTheDocument();
  });

  it("com backend lista os motoristas reais do banco", async () => {
    flags.enabled = true;
    installFetch();
    render(
      <LiveDataProvider>
        <AutoLogin role="operator" />
        <DashboardUsers />
      </LiveDataProvider>,
    );

    expect(await screen.findByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByText("Dados reais do banco")).toBeInTheDocument();
    expect(screen.queryByText("Empresa XYZ Ltda")).not.toBeInTheDocument();
    expect(screen.getByText("BYD Dolphin")).toBeInTheDocument();
    expect(screen.getByText("Sem sessões")).toBeInTheDocument(); // Pedro nao tem sessao
    expect(screen.getByText(/12,50/)).toBeInTheDocument();
  });
});
