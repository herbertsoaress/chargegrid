# Fluxo de dados do ChargeGrid

Entregável **"Arquitetura Funcional: lógica clara de entradas e saídas de dados (Data Flow)"** do EV Challenge 2026.
Os diagramas abrem direto no GitHub (Mermaid). Cada caixa diz o que é **real**, **simulado** ou **futuro**.

Legenda: 🟢 real (roda de verdade neste projeto) · 🟠 simulado (imita o equipamento, com o protocolo real) · ⚪ futuro (depende de acesso/equipamento que ainda não temos).

---

## 1. Visão geral: a arquitetura híbrida

```mermaid
flowchart TB
    subgraph FISICA["Camada física"]
        CH["🟠 Carregador virtual x8<br/>(no lugar do EV Charger FIAP ⚪)"]
        ME["🟠 Medidor de energia virtual<br/>(no lugar do medidor real ⚪)"]
        GW["🟠 Usina e inversor GoodWe<br/>(adaptador simulado; SEMS+ ⚪)"]
    end

    subgraph CONECT["Camada de conectividade"]
        OCPP["🟢 OCPP 1.6J<br/>WebSocket JSON"]
        MOD["🟢 MODBUS TCP"]
        HTTPS["🟢 HTTPS / JSON"]
    end

    subgraph DIGITAL["Camada digital: backend FastAPI"]
        CSMS["🟢 CSMS OCPP<br/>valida e roteia as mensagens"]
        FSM["🟢 Máquina de estados da sessão<br/>A pagamento · B RFID · C cabo · D quitação"]
        IA["🟢 Modelo de previsão de demanda<br/>e preço dinâmico"]
        PAY["🟠 Pagamento sandbox<br/>(provedor real ⚪)"]
        BAL["🟢 Balanceamento de carga"]
        LLM["🟢 Assistente (Gemini)<br/>com regras e contexto filtrado"]
    end

    DB[("🟢 Supabase / PostgreSQL<br/>sessões · pagamentos · eventos<br/>mensagens OCPP · versões do modelo")]

    subgraph UI["Interfaces"]
        APP["🟢 App do motorista"]
        CON["🟢 Console do operador"]
    end

    CH <--> OCPP <--> CSMS
    ME --> MOD --> BAL
    GW -.-> HTTPS
    CSMS --> FSM
    FSM <--> DB
    IA <--> DB
    PAY --> FSM
    BAL --> CON
    APP <--> HTTPS <--> FSM
    APP --> HTTPS --> IA
    CON <--> HTTPS <--> DB
    LLM --> DB
    APP --> LLM
    CON --> LLM
```

**Regra de ouro:** o navegador nunca fala com o Supabase. Só o backend acessa o banco, e segredos (senha do banco, chave do Gemini, credenciais da GoodWe) existem apenas no backend.

---

## 2. Fluxo 1: uma sessão de recarga, ponta a ponta

```mermaid
sequenceDiagram
    autonumber
    actor M as Motorista (app)
    participant API as Backend (FastAPI)
    participant DB as Supabase
    participant C as Carregador (OCPP)

    M->>API: POST /sessions (carregador, modo, meta)
    API->>API: preço = f(previsão + carga real)
    API->>DB: grava sessão com o preço travado e sua origem
    M->>API: POST /confirm-payment  (A = 1)
    C->>API: Authorize(idTag)
    API-->>C: Accepted
    C->>API: StartTransaction
    API->>DB: B = 1 (RFID) e C = 1 (cabo)  ⇒ S = 1: energia liberada
    API-->>C: Accepted + transactionId
    loop a cada poucos segundos
        C->>API: MeterValues (Wh, W, SoC)
        API->>DB: telemetria da sessão
    end
    M->>API: POST /pay (PIX sandbox)
    API->>DB: D = 1 ⇒ T = 1: trava do cabo liberada
    M->>API: POST /stop
    C->>API: StopTransaction
    API->>DB: encerra a sessão e libera o carregador
    M->>API: GET /receipt
    API-->>M: comprovante (kWh × preço, motivo do preço)
```

| Etapa | Entrada | Processamento | Saída |
|---|---|---|---|
| Criar sessão | carregador, modo, meta de bateria, veículo | reserva o carregador, calcula o preço (fluxo 2) | sessão com preço travado |
| Pré-autorizar pagamento (A) | ação do motorista | FSM marca A = 1 | evento `payment_confirmed` |
| Authorize / StartTransaction | `idTag` do motorista, medidor inicial | confere motorista e sessão; FSM marca B e C | energia liberada (S = A·B·C) |
| MeterValues | Wh, W, SoC | atualiza energia, potência e % da sessão | telemetria para app e console |
| Pagamento (D) | método (PIX/cartão) | provedor devolve aprovado/pendente/recusado | trava liberada só se aprovado (T = A·B·C·D) |
| Encerrar | pedido do app + StopTransaction | fecha a sessão e libera o carregador | comprovante |

Fórmulas do docx da Sprint 3, implementadas em `backend/app/services/session_fsm.py`: `S = A·B·C + M` (energia) e `T = A·B·C·D + M` (trava), onde `M` é o bypass de manutenção do operador.

---

## 3. Fluxo 2: previsão de demanda e preço dinâmico

```mermaid
flowchart LR
    CSV["🟢 CSV do grupo<br/>343 registros de recarga"] --> TR["Treino:<br/>índice por dia da semana"]
    P1["🟢 Curva P1(t) do relatório<br/>de Cálculo Integral"] --> SH["Formato horário g(h)"]
    TR --> M["Modelo v N<br/>(tabela forecast_models)"]
    M --> OC["Ocupação prevista<br/>O(dia, hora)"]
    SH --> OC
    ESC["🟠 Cenário: 200 kW contratados,<br/>120 kW de prédio, O_ref = 0,80"] --> OC
    LIVE["Carga real dos carros<br/>(sessões ativas no banco)"] --> MAX["ocupação usada =<br/>máximo(prevista, real)"]
    OC --> MAX
    MAX --> PR["preço = 1,10 + 0,90 × ocupação"]
    PR --> S["Sessão: preço travado<br/>+ origem + ocupação"]
    PR --> TELA["Telas: IA & Previsão, Preços,<br/>tarifas_horarias.csv"]
```

Detalhes e números em [`MODELO_PREVISAO.md`](MODELO_PREVISAO.md).

---

## 4. Fluxo 3: energia do local e balanceamento

| Etapa | Entrada | Saída |
|---|---|---|
| Medidor virtual | curva do prédio + carga dos carros (banco) | registradores MODBUS (float32 em 2 registradores) |
| Leitor MODBUS | leitura pela rede (`pymodbus`) | última leitura + idade |
| Balanceamento | leitura do medidor (se recente) ou cenário de referência | solar/rede/bateria/carga e limite de importação |
| Console | `/billing/balancing`, `/ops/meter` | cartão "Medidor de energia" e painel de balanceamento |

Se o medidor estiver desligado ou a leitura passar de 10 s, o balanceamento volta sozinho para o cenário de referência (120 kW), e a tela informa a origem (`modbus` ou `cenario`).

---

## 5. Fluxo 4: assistente de IA

```mermaid
flowchart LR
    Q["Pergunta do usuário"] --> AUTH{"logado?"}
    AUTH -- "não" --> R["Assistente por regras"]
    AUTH -- "sim" --> LIM{"dentro do limite<br/>de perguntas?"}
    LIM -- "não" --> R
    LIM -- "sim" --> CTX["Contexto do banco<br/>filtrado pelo papel"]
    CTX --> G["Gemini<br/>regras fixas + contexto + pergunta"]
    G -- "erro/lento" --> R
    G --> ANS["Resposta ✨ IA"]
    R --> ANS2["Resposta por regras"]
```

**O que sai para o Gemini:** regras do assistente, um resumo do banco filtrado pelo papel (motorista vê só as próprias sessões; operador vê agregados e nomes abreviados), a previsão do dia e a pergunta. **Nunca sai:** e-mails, senhas, tokens, números de série, dados de outros usuários.

---

## 6. Real × simulado × futuro

| Componente | Situação | Como é identificado no sistema |
|---|---|---|
| API, banco (Supabase), autenticação, máquina de estados, comprovantes, auditoria | 🟢 real | `/health` mostra o motor do banco |
| Protocolo OCPP 1.6J (servidor, validação, log de mensagens) | 🟢 real | tela **Logs OCPP** com mensagens do banco |
| Carregador | 🟠 virtual (fala OCPP de verdade) | `ocpp.simulator` no `/health`; "Virtuais (simulados)" na tela |
| Protocolo MODBUS TCP (servidor e leitor) | 🟢 real | validado contra o cliente `pymodbus` |
| Medidor de energia | 🟠 virtual; mapa de registradores **assumido** | selo "Simulado" no cartão do medidor |
| Modelo de previsão e preço | 🟢 real, calibrado com o CSV do grupo | versão, fonte e nº de registros na tela |
| Nível de ocupação (0,80) e capacidade (80 kW) | 🟠 suposição de cenário | descrito em `MODELO_PREVISAO.md` |
| Pagamento | 🟠 sandbox; troca por provedor real é uma classe | `origem: sandbox` no comprovante e `/health` |
| Telemetria GoodWe | 🟠 adaptador simulado | campo `origem` e selo "Dados simulados" |
| Assistente com IA | 🟢 real (Gemini) com reserva por regras | selo "Resposta gerada por IA" |
| Carregador FIAP físico | ⚪ futuro | mesmo protocolo: só muda o endereço |
| GoodWe OpenAPI real | ⚪ futuro (depende de credenciais) | adaptador real é um esqueleto ainda não validado |
| Pagamento real | ⚪ futuro | `services/payments.py` |
