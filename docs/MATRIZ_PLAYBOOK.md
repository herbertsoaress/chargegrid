# Matriz: o que a GoodWe pede × onde está no projeto

Compara o **playbook do EV Challenge 2026 (trilha ChargeGrid Intelligence)** e a **Proposta de Evolução Técnica** do grupo com o que foi construído.
Legenda: ✅ atendido · 🟡 atendido em parte ou simulado (dito na tela) · ⏳ depende de terceiros ou de publicação · ❌ não feito.

---

## 1. Playbook da GoodWe

### Problema central
> "Ausência de mecanismos integrados em eletropostos comerciais para orquestrar potência, registrar ciclos, faturar e comunicar."

| Verbo | Onde está | Status |
|---|---|---|
| Orquestrar potência | balanceamento e peak shaving no console (`DashboardLoadManagement`, `services/balancing.py`, `POST /ops/peak-shaving`) | 🟡 simulado, sem comandar carregador físico |
| Registrar ciclos | sessões, eventos e mensagens OCPP no banco (`charging_sessions`, `session_events`, `ocpp_messages`) | ✅ |
| Faturar | preço por kWh, pagamento, comprovante, faturamento (`services/pricing.py`, `routers/sessions.py`, `routers/billing.py`) | ✅ (pagamento sandbox) |
| Comunicar | OCPP 1.6J (`services/ocpp_csms.py`, `routers/ocpp.py`) e MODBUS TCP (`services/modbus_meter.py`) | ✅ protocolos reais, equipamento virtual |

### Os 4 pilares

| Pilar | Ação pedida | O que existe | Status |
|---|---|---|---|
| **Controle de demanda** | gerenciar a potência entregue | limite de 200 kW, prédio de 120 kW, capacidade de 80 kW para carros; balanceamento usando a leitura do medidor; alerta de saturação prevista; peak shaving com auditoria | 🟡 simulado |
| **Protocolos abertos** | integração via OCPP e MODBUS | servidor OCPP 1.6J validado pelo esquema oficial, carregadores virtuais, log de todas as mensagens; medidor MODBUS TCP com leitor (interoperável com o `pymodbus`) | ✅ protocolo · 🟡 equipamento simulado |
| **Tarifação e pagamento** | cobrança dinâmica por APIs de pagamento | preço R$ 1,10 a R$ 2,00 gerado pelo modelo, travado na sessão; camada de pagamento com provedor sandbox e recusa/pendência tratadas; troca por provedor real = uma classe | ✅ preço · 🟡 pagamento sandbox |
| **IA aplicada** | previsão de picos e análise de sessões | modelo calibrado com o CSV do grupo (previsão por hora e dia da semana, preço, alerta), perfil de "sessão típica" por classe de potência, assistente com Gemini | ✅ |

### Arquitetura híbrida (3 camadas)

| Camada | Pedido | Onde | Status |
|---|---|---|---|
| Digital | regras de controle, módulo analítico (IA), APIs de pagamento | backend FastAPI: máquina de estados, `forecast.py`, `payments.py` | ✅ |
| Conectividade | rede/internet | HTTPS (API), WebSocket (OCPP), TCP (MODBUS) | ✅ |
| Física | EV Charger FIAP, medidores (MODBUS), controladores (OCPP) | carregadores e medidor **virtuais** com os protocolos reais | 🟡 · carregador físico ⏳ |

### Ponto de convergência (ChargeGrid Intelligence)

| Linha da tabela | Pedido | Situação |
|---|---|---|
| Objeto principal | otimização comercial, pagamentos, operação física em tempo real | ✅ (operação física simulada) |
| Integração-base | EV Charger FIAP + GoodWe + sistemas de pagamento (OCPP/MODBUS) | 🟡 OCPP/MODBUS reais; FIAP e GoodWe simulados; pagamento sandbox |
| Papel da IA | previsão de demanda da rede, tarifação dinâmica | ✅ |

### "IA como infraestrutura lógica"

| Bloco | Pedido | Onde | Status |
|---|---|---|---|
| Interpretação | decodificar eventos de sessão via protocolos industriais em tempo real | mensagens OCPP viram eventos da sessão (`ocpp_service.py`) | ✅ |
| Preditividade | prever necessidade de expansão antes da sobrecarga | alerta de **saturação prevista** por hora | 🟡 alerta, sem plano de expansão |
| Precificação | tarifa dinâmica pelo comportamento da rede | `pricing.py` (ocupação prevista + carga real) | ✅ |
| Conversão | NLP para orientar o usuário | assistente com Gemini, regras e guardrails | ✅ |

### Base regulatória
O playbook cita a **REN ANEEL nº 1.000/2021**: exploração comercial livre (preço negociado, o que justifica tarifação dinâmica) e comunicação prévia com padrões abertos (o que justifica OCPP). O roteiro de apresentação usa esses dois argumentos. **Antes de citar número de artigo, conferir o texto oficial** ([ANEEL](https://www2.aneel.gov.br/cedoc/ren20211000.html)).

### Os 4 entregáveis

| Entregável | Onde |
|---|---|
| Arquitetura funcional (Data Flow) | [`FLUXO_DE_DADOS.md`](FLUXO_DE_DADOS.md) |
| Papel da IA integrada | [`MODELO_PREVISAO.md`](MODELO_PREVISAO.md): a IA calcula o preço e o alerta; o chat é só a interface |
| Aderência ao contexto (comercial) | um local comercial (FIAP Paulista), tarifa e curva de posto comercial, sem lógica de condomínio |
| Visão de produto real | [`ROTEIRO_PITCH.md`](ROTEIRO_PITCH.md) |

---

## 2. Proposta de Evolução Técnica (documento do grupo, 13/09/2026)

| Etapa | Entregável | Status |
|---|---|---|
| 0 Alinhamento | inventário do SEMS+, pedido de API, confirmação de carregador | ⏳ depende da FIAP e da GoodWe (fora do código) |
| 1 Base full-stack | frontend + FastAPI + PostgreSQL + endpoint de saúde; dados persistem após reinício | ✅ local com Supabase · ⏳ publicação online (Vercel e Render) |
| 2 Fluxo funcional | usuário, estação, carregador, máquina de estados, histórico, controlador simulado | ✅ (o controlador agora fala OCPP) |
| 3 Integração GoodWe | adaptador, leitura autorizada, logs e tratamento de erros | 🟡 adaptador simulado documentado; real ⏳ credenciais |
| 4 Camada comercial | preço por kWh, pagamento sandbox, comprovante, dashboard do estabelecimento | ✅ |
| 5 IA e protocolos abertos *(proposta nova)* | previsão e preço por IA, OCPP, MODBUS | ✅ implementado · ⏳ aprovação do Scrum Master (ver [`ETAPA_5_PROPOSTA.md`](ETAPA_5_PROPOSTA.md)) |

### "Meta recomendada para a próxima banca"
- Aplicação web pública com frontend e backend próprios: ⏳ falta publicar (o projeto está pronto para isso).
- Banco persistente com usuários, estações, carregadores e sessões: ✅
- Fluxo de recarga com estados e registro de eventos: ✅
- Integração SEMS+ em modo leitura, ou adaptador simulado documentado: 🟡 adaptador simulado documentado.
- Demonstração que identifique o que é real, simulado e futuro: ✅ (selos na interface e campo `origem` na API)

### Riscos e controles da proposta

| Risco | Controle | Status |
|---|---|---|
| Credenciais ou API indisponíveis | adaptador simulado com a mesma interface | ✅ |
| Carregador físico indisponível | carregador virtual; sem alegar acionamento real | ✅ |
| Exposição de segredos | só no backend (`.env`); nada no React; token de login só em memória | ✅ |
| Escopo excessivo | ampliação registrada como Etapa 5 | 🟡 aguardando aprovação |
| Exposição de dados operacionais | números de série mascarados (`****0001`) | ✅ |
