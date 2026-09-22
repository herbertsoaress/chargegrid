# GoodWe ChargeGrid Intelligence

Plataforma de gestão inteligente de recarga para veículos elétricos, com **duas interfaces** dentro do
mesmo projeto: um **Dashboard Web** para o operador da rede de carregadores e um **App Mobile simulado**
para o motorista. Ambas consomem os mesmos dados em tempo real através de **um único** `LiveDataProvider`
(montado em `pages/Index.tsx`), então uma ação em uma interface (por exemplo, iniciar uma recarga pelo app)
reflete imediatamente na outra (o carregador correspondente muda de estado no dashboard).

Há dois modos de execução:
- **Simulação local** (padrão, sem `VITE_API_URL`): tudo em memória no navegador.
- **Com backend** (`VITE_API_URL` definida): **login real** (motorista no app, operador no console), sessões,
  eventos, pagamentos sandbox e comprovantes gravados pelo backend FastAPI (SQLite ou Supabase/PostgreSQL),
  preço calculado pelo modelo de previsão e, com os simuladores ligados, recarga conduzida por carregadores
  virtuais que falam OCPP 1.6J. Se a API cair, o app segue em simulação local.
  Veja `../GUIA_DO_PROJETO.md` e a pasta `../docs/`.

Este projeto foi recriado localmente a partir do projeto Lovable **GoodWe Smart Charge**
(`c1fb1072-97e0-4dac-9d6b-33752d5f2e9f`), removendo a dependência de build exclusiva do Lovable
(`lovable-tagger`) para rodar como um projeto Vite + React padrão em qualquer máquina.

## As duas interfaces

### 1. Dashboard Web (`src/components/dashboard`)

Console de operação com 8 áreas, organizadas em 3 grupos na barra lateral:

**Operação**
- **Painel Geral** (`DashboardOverview`) — KPIs (energia hoje, sessões ativas, faturamento, capacidade
  da rede), gráfico de potência distribuída em tempo real, demanda de potência (24h), receita semanal,
  tabela de sessões em andamento e próximas liberações.
- **Balanceamento** (`DashboardLoadManagement`) — algoritmo de balanceamento dinâmico (DLB), painel
  "Energy Engine" com a decisão de distribuição de potência por carregador, simulador de infraestrutura
  (sliders), gráfico de carga total vs. carga EV vs. limite contratado e, com backend, o **cartão do medidor
  MODBUS** (`DashboardMeter`: tensão, corrente, potência, frequência e energia, com o selo "Simulado").
- **Estações** (`DashboardChargers`) — grid de cards por carregador com status, potência, tarifa, modo de
  recarga e detalhes expansíveis.
- **Assistente IA** — abre o painel lateral (`OperatorAssistantPanel`), descrito abaixo.

**Engenharia**
- **Logs OCPP** (`DashboardLogs`) — com backend, mostra as **mensagens OCPP 1.6J reais** trocadas com os
  carregadores (BootNotification, Authorize, StartTransaction, MeterValues, StatusNotification, Heartbeat…),
  gravadas no banco; sem backend, um terminal simulado. Também traz o painel de saúde do banco/API.
- **IA & Previsão** (`DashboardInsights`) — o **modelo de previsão de demanda e preço**: preço agora, previsão
  de ocupação e de preço por hora do dia, alerta de saturação, versão e métricas do modelo, um cartão com
  o preço do kWh por modo de recarga (acréscimo por potência), botão **Retreinar modelo** (operador),
  download `tarifas_horarias.csv`, e os cards de insight (peak shaving, manutenção) com o botão que aciona
  `applyPeakShaving()`. Sem backend, usa uma cópia local do cálculo.
- **Simulador "E Se...?"** (`DashboardSimulator`) — sliders para nº de carregadores, consumo do prédio,
  limite contratado, veículos simultâneos e geração solar; compara o pico de demanda "sem" e "com"
  ChargeGrid e projeta o ROI em 24 meses.

**Comercial**
- **Faturamento** (`DashboardBilling`) — receita mensal, faturas recentes e split de receita entre
  operador, proprietário do local e taxa de plataforma.
- **Usuários & Frotas** (`DashboardUsers`) — gestão de usuários/frotas: com backend lista os usuários
  reais do banco (sessões e total gasto); sem backend, exemplos fixos.

O console exige **login de operador** (`OperatorLogin`) quando o backend está no ar.

### 2. App Mobile simulado (`src/components/mobile`)

Renderizado dentro de uma moldura de smartphone (`.phone-frame`) ao lado do dashboard na tela principal,
navegando entre telas via `useState` (sem router):

`Splash → Login/Cadastro → Home (mapa/lista de estações) → Mapa (Leaflet) → Detalhes do carregador →
Configuração da sessão (modo/meta/horário, com a tarifa do momento) → Recarga em andamento (círculo de
progresso) → Histórico → Perfil (veículos) → Preços`

- **MobileHome** — busca e lista de estações próximas agrupadas por região, com o widget flutuante do
  assistente (`MobileAssistant`).
- **MobileMap** — mapa real com Leaflet + tiles do OpenStreetMap (estilo dark via filtro CSS), pins
  coloridos por status, popup com detalhes e ação de reservar.
- **MobileChargerDetail** — status do carregador, potência/tarifa, opções de início de sessão (QR
  Code/RFID).
- **MobileSessionSetup** — escolha de horário de saída, nível de bateria desejado e modo de recarga
  (Rápido, Econômico, Sustentável, Garantido), com estimativa de tempo/energia/custo antes de confirmar.
  O custo já soma o acréscimo do modo e o tempo de uso (extensão aprovada — ver
  `../docs/TARIFA_TEMPO_E_OCIOSIDADE.md`).
- **MobileCharging** — sessão em andamento: anel de progresso SVG, potência atual, kWh entregues, tempo
  decorrido, custo estimado (com backend, inclui tempo e ociosidade) e botão de finalizar. Avisa quando
  a bateria enche e o carro fica parado no carregador além da tolerância.
- **MobileHistory** — sessões concluídas (as gerada nesta sessão do navegador + um histórico fixo de
  exemplo), com total de kWh e custo do mês.
- **MobileLogin** — login e cadastro de motorista (o cadastro nunca cria operador); "Entrar como
  demonstração" só aparece se o backend liberar (`/health` → `demo_login`).
- **MobileProfile** — dados da conta, **veículos** (adicionar e remover; a placa é validada e o veículo
  usado numa sessão não pode ser removido), total gasto e o cartão de **pontuação de fidelidade** (10
  pontos por kWh + bônus por bater a meta semanal, com faixas Bronze/Prata/Ouro — extensão aprovada, só
  visual, ver `../docs/PONTUACAO_FIDELIDADE.md`).
- **MobilePricing** — preço do kWh agora e por hora, vindos do modelo de previsão, com as faixas fora de
  ponta, intermediária e ponta.

## Stack

- **React 18** + **TypeScript**
- **Vite 5** (`@vitejs/plugin-react-swc`)
- **Tailwind CSS** + **shadcn/ui** (Radix UI primitives, `class-variance-authority`)
- **Recharts** — todos os gráficos (área, linha, barra) do dashboard
- **Leaflet** + **OpenStreetMap** — mapa de estações no app mobile
- **TanStack React Query** — provider configurado em `App.tsx` (`QueryClientProvider`)
- **React Router DOM** — rotas `/`, `/assistente`, `/dashboard`
- **Vitest** + **Testing Library** + **jsdom** — testes em `src/test/`

## Como instalar e rodar

```bash
npm install
npm run dev        # http://localhost:8080
npm run build      # build de produção em dist/
npm run preview    # serve o build de produção localmente
npm test           # roda a suíte de testes (vitest run)
npm run test:watch # vitest em modo watch
npm run lint       # eslint
```

Nenhuma variável é obrigatória — sem `.env` o projeto roda 100% no navegador, sem backend.

Para conectar ao backend (que por sua vez usa o Supabase):

```bash
cp .env.example .env     # Windows: copy .env.example .env
# edite VITE_API_URL, ex.: http://localhost:8000
```

`VITE_API_URL` é a **única** variável do frontend e é pública (vai para o navegador). Senha do banco,
`SECRET_KEY` e credenciais da GoodWe ficam só em `backend/.env`.

## Estrutura de pastas

```
src/
  components/
    ai/            Assistente (Gemini via backend, com reserva por regras; painel do operador e widget do app)
    dashboard/      LiveDataProvider (estado global) + WebDashboard + 8 painéis de operação
    mobile/         MobileApp (roteador por estado) + 9 telas do app simulado
    ui/             Componentes shadcn/ui (Radix + Tailwind)
    NavLink.tsx     Wrapper de compatibilidade sobre o NavLink do react-router
  hooks/            use-mobile (media query), use-toast (fila de toasts do shadcn)
  lib/utils.ts      Helper `cn()` (clsx + tailwind-merge)
  lib/backend/      Integração com o backend: config (VITE_API_URL), client HTTP tipado, tipos e mappers
  lib/pricing.ts    Cópia local do cálculo de preço (usada sem backend)
  pages/            Index (tela principal com o toggle App/Dashboard/Ambos), Assistente,
                    DashboardEstacoes (protótipo estático adicional) e NotFound
  test/             setup.ts (mocks de jsdom), testes do cliente/mappers da API, do LiveDataProvider e
                    do estado compartilhado entre App e Dashboard
  index.css         Design tokens (HSL) e utilitárias (glass-card, glow, phone-frame, etc.)
```

## Como funciona o `LiveDataProvider`

`src/components/dashboard/LiveDataProvider.tsx` é a única fonte de verdade compartilhada entre o
Dashboard e o App Mobile — `pages/Index.tsx` monta **uma única** instância no topo e as duas interfaces
leem dela (há um teste de regressão em `src/test/index-shared-state.test.tsx`).

Com `VITE_API_URL` definida, o provider cuida do **login** (`login`, `signup`, `loginDemo`, `logout`; motorista e
operador têm tokens separados, guardados **só em memória**), dos veículos do motorista e da previsão de preço
(atualizada periodicamente, com cálculo local de reserva). Cada sessão iniciada pelo app é criada no backend
(`createSession` → pagamento pré-autorizado). Daí em diante há dois caminhos:

- **Modo OCPP** (backend com `OCPP_SIMULATOR=true`): o app só cria a sessão e confirma o pagamento. Quem
  autentica o RFID, conecta o cabo, inicia a transação e envia os `MeterValues` é o **carregador virtual**, por
  OCPP. O app consulta a sessão a cada 2 s e mostra os números que o carregador mediu.
- **Modo REST** (sem simulador): o app passa pelas etapas RFID → cabo e envia os `MeterValues` ele mesmo.

Em ambos, o encerramento faz o pagamento sandbox e busca o comprovante. Falhas de rede não travam a
interface: o app continua na simulação local e o indicador de conexão do Dashboard mostra o estado
(API + PostgreSQL / API + SQLite / Simulação local).

Estado mantido:
- **`chargers`** — 8 carregadores (`CG-001`…`CG-008`) com status (`available`, `preparing`, `charging`,
  `finishing`, `faulted`), potência atual/máxima, usuário, veículo, modo, tarifa e energia da sessão.
- **`activeSessions`** — sessões iniciadas pelo app mobile (`startSession`), com progresso, potência,
  tempo decorrido e custo estimado calculados a cada tick.
- **`completedSessions`** — sessões encerradas (`endSession`), com kWh, custo, duração e data.
- **`logs`** — eventos OCPP simulados (BootNotification, StartTransaction, LoadBalancing,
  StatusNotification, Heartbeat, etc.), com nível INFO/ACK/WARN/ERR.
- **`load`** — série temporal (últimos ~20 pontos) de demanda total, demanda dos EVs e limite da rede.
- **`totals`** — kWh hoje, receita hoje, sessões ativas, % de carga da rede, potência distribuída.

Funções expostas: **`startSession`**, **`endSession`** e **`applyPeakShaving`** (reduz por 30s a potência
dos carregadores em modo Econômico e registra o evento nos logs).

Um `setInterval` de **2 segundos** avança a simulação inteira a cada tick: incrementa o progresso das
sessões em carregamento, faz carregadores "preparando" começarem a carregar, libera carregadores
"finalizando" de volta para disponível, ocasionalmente inicia novas sessões simuladas em carregadores
livres, recalcula a série de carga da rede e adiciona novos logs OCPP com probabilidade de 70% por tick.

### Parâmetros do cenário simulado

- **Limite da rede:** 200 kW (`NETWORK_LIMIT`)
- **Consumo base do prédio:** 120 kW (fixo, usado no cálculo da série `load`)
- **Carregadores:** até 22 kW cada (Type 2 AC), 8 unidades
- **Regra de segurança:** a contribuição dos EVs na série de carga (`evCapped`) é sempre limitada para
  que a demanda total nunca ultrapasse 195 kW — ou seja, os veículos elétricos nunca fazem a rede
  passar de 195 kW, mesmo somando o consumo fixo do prédio.

## Limitações (protótipo de demonstração)

- **Backend opcional** — sem `VITE_API_URL` todo o estado vive em memória no navegador e recarregar a
  página reinicia a simulação. Com backend, ficam persistidos: contas, veículos, sessões, comprovantes,
  eventos, mensagens OCPP e versões do modelo.
- **Carregadores e medidor virtuais** — com backend, o protocolo é real (OCPP 1.6J e MODBUS TCP), mas o
  equipamento é virtual e aparece como simulado. Sem backend, os logs OCPP são só uma imitação do formato.
  A visão dos 8 carregadores no navegador é uma simulação visual; o que vale como dado é o que o backend grava.
- **Previsão calibrada com dados de um veículo** — o modelo (backend) capta o **padrão da semana**, não o
  consumo de um dia exato; capacidade (80 kW para carros) e ocupação de referência são **suposições de
  cenário**. Detalhes em `../docs/MODELO_PREVISAO.md`. O **assistente de chat** usa o Gemini **somente se** o
  backend tiver `GEMINI_API_KEY` e o app estiver logado (selo "✨ Resposta gerada por IA"); sem isso responde
  por regras.
- **Sem pagamento real** — o pagamento é **sandbox** (aprovação simulada pelo backend); nenhuma transação
  financeira é processada.
- **Login** — com backend, o app e o console exigem login (o cadastro cria só motoristas; operadores vêm de
  `OPERATOR_EMAILS`). "Entrar como demonstração" só existe com `ALLOW_DEMO_LOGIN=true`; desligue-o depois da
  banca. Sem backend não há login (simulação local).
- **GoodWe simulada** — o adaptador real é um esqueleto ainda não validado contra a API da GoodWe.

## Como hospedar em produção

O projeto gera um build estático padrão do Vite (`npm run build` → pasta `dist/`), então qualquer
hospedagem de arquivos estáticos funciona:

- **Vercel**: importe o repositório com *Root Directory* `goodwe-grid-smart` (o `vercel.json` já define
  build, saída e fallback de rotas) e defina `VITE_API_URL` com a URL pública do backend (Render).
- **Netlify**: `npm run build` como build command e `dist` como publish directory. Se usar rotas do
  React Router diretamente por URL (ex.: acessar `/dashboard` sem passar pela home), adicione um redirect
  SPA (`/* /index.html 200`) em `netlify.toml` ou `public/_redirects`.
- **Servidor HTTP genérico**: rode `npm run build` e sirva a pasta `dist/` com qualquer servidor estático
  (nginx, Caddy, `serve -s dist`, etc.), configurando fallback para `index.html` em rotas desconhecidas
  pelo mesmo motivo acima (SPA com React Router).
