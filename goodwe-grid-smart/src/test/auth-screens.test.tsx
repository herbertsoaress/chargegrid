import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/backend/config", () => ({
  API_URL: "http://api.test",
  get backendEnabled() {
    return flags.enabled;
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { MobileApp } from "@/components/mobile/MobileApp";
import { WebDashboard } from "@/components/dashboard/WebDashboard";

let calls: string[] = [];
let vehicles: { id: number; plate: string; model: string }[] = [];
let demoLogin = true;
let apiDown = false;

const PEOPLE: Record<string, { id: number; name: string; role: string }> = {
  "maria@example.com": { id: 1, name: "Maria Souza", role: "driver" },
  "operador@empresa.com": { id: 2, name: "Carlos Operador", role: "operator" },
};

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (apiDown) throw new TypeError("Failed to fetch");
      const path = url.replace("http://api.test", "");
      const method = init.method ?? "GET";
      calls.push(`${method} ${path}`);
      const body = init.body ? JSON.parse(init.body as string) : {};
      const auth = (init.headers as Record<string, string>)?.Authorization ?? "";
      const reply = (status: number, payload: unknown) => ({
        ok: status < 400,
        status,
        statusText: "x",
        json: async () => payload,
      });

      if (path === "/health")
        return reply(200, {
          status: "ok", version: "0.2.0", env: "development", database: { ok: true, engine: "postgresql" },
          goodwe: { origem: "simulado" }, demo_login: demoLogin,
        });
      if (path === "/stations") return reply(200, [{ id: 1, name: "FIAP Paulista", type: "comercial", chargers: [{ id: 2, code: "CG-002", name: "FIAP #2" }] }]);
      if (path === "/auth/login") {
        const person = PEOPLE[String(body.email).toLowerCase()];
        if (!person || body.password !== "certa123") return reply(401, { detail: "E-mail ou senha invalidos" });
        return reply(200, { access_token: `tok-${body.email}`, role: person.role, name: person.name, user_id: person.id });
      }
      if (path === "/auth/signup") {
        PEOPLE[String(body.email).toLowerCase()] = { id: 7, name: body.name, role: "driver" };
        return reply(200, { access_token: `tok-${body.email}`, role: "driver", name: body.name, user_id: 7 });
      }
      if (path === "/auth/demo-login") {
        const email = body.role === "operator" ? "operador@empresa.com" : "maria@example.com";
        return reply(200, { access_token: `tok-${email}`, role: body.role, name: PEOPLE[email].name, user_id: PEOPLE[email].id });
      }
      if (path === "/auth/me") {
        const email = auth.replace("Bearer tok-", "");
        const person = PEOPLE[email];
        return reply(200, { id: person.id, name: person.name, email, role: person.role });
      }
      if (path === "/vehicles/me") return reply(200, vehicles);
      if (path === "/vehicles" && method === "POST") {
        vehicles = [...vehicles, { id: vehicles.length + 10, plate: String(body.plate).toUpperCase().replace("-", ""), model: body.model }];
        return reply(200, vehicles[vehicles.length - 1]);
      }
      if (path.startsWith("/vehicles/") && method === "DELETE") {
        vehicles = vehicles.filter((v) => `/vehicles/${v.id}` !== path);
        return { ok: true, status: 204, statusText: "No Content", json: async () => undefined };
      }
      if (path.startsWith("/sessions?")) return reply(200, []);
      return reply(404, { detail: "rota nao mockada" });
    }),
  );
}

const field = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;
const typeInto = (label: RegExp | string, value: string) => fireEvent.change(field(label), { target: { value } });

beforeEach(() => {
  calls = [];
  vehicles = [];
  demoLogin = true;
  apiDown = false;
  flags.enabled = true;
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

async function openLogin() {
  render(<MobileApp />);
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled());
}

describe("App do motorista: entrar e criar conta", () => {
  it("valida os campos antes de chamar o servidor", async () => {
    await openLogin();
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Informe um e-mail válido.")).toBeInTheDocument();

    typeInto("E-mail", "maria@example.com");
    typeInto("Senha", "123");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("A senha precisa ter pelo menos 6 caracteres.")).toBeInTheDocument();
    expect(calls).not.toContain("POST /auth/login");
  });

  it("senha errada mostra o erro e continua na tela de login", async () => {
    await openLogin();
    typeInto("E-mail", "maria@example.com");
    typeInto("Senha", "errada123");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("E-mail ou senha inválidos.")).toBeInTheDocument();
    expect(screen.queryByText(/Encontrar Estação/)).not.toBeInTheDocument();
  });

  it("login correto leva a Home com o nome do usuario", async () => {
    await openLogin();
    typeInto("E-mail", "maria@example.com");
    typeInto("Senha", "certa123");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Olá, Maria")).toBeInTheDocument();
    expect(calls).toContain("POST /auth/login");
    expect(calls).toContain("GET /vehicles/me");
  });

  it("criar conta pede o nome, cadastra e ja entra", async () => {
    render(<MobileApp />);
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Criar conta e entrar" })).toBeEnabled());
    typeInto("Nome", "Ana Paula");
    typeInto("E-mail", "ana@example.com");
    typeInto("Senha", "senha1234");
    fireEvent.click(screen.getByRole("button", { name: "Criar conta e entrar" }));
    expect(await screen.findByText("Olá, Ana")).toBeInTheDocument();
    expect(calls).toContain("POST /auth/signup");
  });

  it("botao 'Entrar como demonstracao' so aparece quando o servidor permite", async () => {
    await openLogin();
    expect(await screen.findByRole("button", { name: "Entrar como demonstração" })).toBeInTheDocument();
  });

  it("com a demonstracao desligada no servidor o botao nao existe", async () => {
    demoLogin = false;
    await openLogin();
    expect(screen.queryByRole("button", { name: "Entrar como demonstração" })).not.toBeInTheDocument();
  });

  it("entrar como demonstracao funciona", async () => {
    await openLogin();
    fireEvent.click(await screen.findByRole("button", { name: "Entrar como demonstração" }));
    expect(await screen.findByText("Olá, Maria")).toBeInTheDocument();
  });

  it("sem backend configurado o app segue direto para a Home (modo simulado)", () => {
    flags.enabled = false;
    render(<MobileApp />);
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(screen.getByText("Olá, João")).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("servidor fora do ar: avisa e permite continuar em modo simulado", async () => {
    apiDown = true;
    render(<MobileApp />);
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText(/Servidor indisponível/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continuar em modo simulado" }));
    expect(await screen.findByText("Olá, João")).toBeInTheDocument();
  });
});

describe("Perfil do motorista", () => {
  async function loginAndOpenProfile() {
    await openLogin();
    typeInto("E-mail", "maria@example.com");
    typeInto("Senha", "certa123");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await screen.findByText("Olá, Maria");
    fireEvent.click(screen.getByText("M", { selector: "span" })); // avatar da Home
    await screen.findByText("Meus veículos");
  }

  it("mostra a conta real e sem o cartao inventado", async () => {
    await loginAndOpenProfile();
    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByText("maria@example.com")).toBeInTheDocument();
    expect(screen.getByText("PIX (ambiente de teste)")).toBeInTheDocument();
    expect(screen.queryByText(/Visa/)).not.toBeInTheDocument();
    expect(screen.queryByText(/joao\.silva@email\.com/)).not.toBeInTheDocument();
    expect(screen.getByText("Nenhum veículo cadastrado ainda.")).toBeInTheDocument();
  });

  it("cadastra, valida e remove veiculos", async () => {
    await loginAndOpenProfile();

    typeInto("Modelo do veículo", "BYD Dolphin");
    typeInto("Placa", "###");
    fireEvent.click(screen.getByRole("button", { name: /Adicionar veículo/ }));
    expect(await screen.findByText("Placa inválida (ex.: ABC1D23).")).toBeInTheDocument();
    expect(calls).not.toContain("POST /vehicles");

    typeInto("Placa", "abc-1d23");
    fireEvent.click(screen.getByRole("button", { name: /Adicionar veículo/ }));
    expect(await screen.findByText("BYD Dolphin")).toBeInTheDocument();
    expect(screen.getByText("ABC1D23")).toBeInTheDocument();
    expect(calls).toContain("POST /vehicles");

    fireEvent.click(screen.getByRole("button", { name: "Remover BYD Dolphin" }));
    await waitFor(() => expect(screen.queryByText("BYD Dolphin")).not.toBeInTheDocument());
    expect(calls.some((c) => c.startsWith("DELETE /vehicles/"))).toBe(true);
  });

  it("sair volta para a tela inicial e exige novo login", async () => {
    await loginAndOpenProfile();
    fireEvent.click(screen.getByText("Sair"));
    expect(await screen.findByText(/Recarga inteligente para veículos elétricos/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByLabelText("Senha")).toBeInTheDocument(); // pede login de novo
  });
});

describe("Console do operador", () => {
  it("pede login antes de mostrar o dashboard e rejeita conta de motorista", async () => {
    render(<WebDashboard />);
    expect(await screen.findByText("Console do Operador")).toBeInTheDocument();
    expect(screen.queryByText("Painel Geral")).not.toBeInTheDocument();

    typeInto("E-mail", "maria@example.com");
    typeInto("Senha", "certa123");
    fireEvent.click(screen.getByRole("button", { name: "Entrar no console" }));
    expect(await screen.findByText("Esta conta não tem acesso de operador.")).toBeInTheDocument();
    expect(screen.queryByText("Painel Geral")).not.toBeInTheDocument();
  });

  it("operador entra, ve o painel e pode sair", async () => {
    render(<WebDashboard />);
    await screen.findByText("Console do Operador");
    typeInto("E-mail", "operador@empresa.com");
    typeInto("Senha", "certa123");
    fireEvent.click(screen.getByRole("button", { name: "Entrar no console" }));
    expect((await screen.findAllByText("Painel Geral")).length).toBeGreaterThan(0);
    expect(screen.getByTitle(/Carlos Operador/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sair do console" }));
    expect(await screen.findByText("Console do Operador")).toBeInTheDocument();
  });

  it("entrar como demonstracao no console", async () => {
    render(<WebDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Entrar como demonstração" }));
    expect((await screen.findAllByText("Painel Geral")).length).toBeGreaterThan(0);
  });

  it("sem backend (ou com a API fora do ar) o console abre em modo simulado, sem login", async () => {
    flags.enabled = false;
    const { unmount } = render(<WebDashboard />);
    expect((await screen.findAllByText("Painel Geral")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Console do Operador")).not.toBeInTheDocument();
    unmount();

    flags.enabled = true;
    apiDown = true;
    render(<WebDashboard />);
    await waitFor(() => expect(screen.getAllByText("Painel Geral").length).toBeGreaterThan(0), { timeout: 4000 });
  });
});

