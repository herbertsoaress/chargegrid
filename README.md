# ChargeGrid

Protótipo full-stack do **ChargeGrid Intelligence** (Challenge FIAP 2026 | GoodWe Brasil, trilha comercial e varejo), construído a partir da *Proposta de Evolução Técnica*, do playbook do EV Challenge 2026 e das entregas das Sprints anteriores (estatística e regressão, cálculo integral, lógica booleana do ESP32 e o MVP visual do Lovable).

O SEMS+ continua sendo a camada de gestão energética da GoodWe. O ChargeGrid acrescenta a **camada comercial**: sessões de recarga, tarifação dinâmica por IA, pagamento, faturamento e comunicação por protocolos abertos (OCPP e MODBUS).

> **Novo por aqui?** Leia o [`GUIA_DO_PROJETO.md`](GUIA_DO_PROJETO.md): explica cada pasta e arquivo e onde colocar cada senha (`backend/.env` para segredos; `goodwe-grid-smart/.env` só com `VITE_API_URL`).

## Documentação (pasta `docs/`)

| Documento | Para quê |
|---|---|
| [`FLUXO_DE_DADOS.md`](docs/FLUXO_DE_DADOS.md) | Diagramas de entradas e saídas, e a tabela real × simulado × futuro |
| [`MODELO_PREVISAO.md`](docs/MODELO_PREVISAO.md) | Dados, fórmulas, resultados e limites do modelo de previsão e preço |
| [`MATRIZ_PLAYBOOK.md`](docs/MATRIZ_PLAYBOOK.md) | O que a GoodWe pede × onde está no projeto |
| [`TARIFA_TEMPO_E_OCIOSIDADE.md`](docs/TARIFA_TEMPO_E_OCIOSIDADE.md) | Tarifa por tempo de uso, por potência do modo e por ociosidade (extensão) |
| [`PONTUACAO_FIDELIDADE.md`](docs/PONTUACAO_FIDELIDADE.md) | Pontos por consumo e por regularidade, com faixas (extensão, só visual) |
| [`ROTEIRO_PITCH.md`](docs/ROTEIRO_PITCH.md) | Roteiro da apresentação, da demonstração e perguntas prováveis |
| [`ETAPA_5_PROPOSTA.md`](docs/ETAPA_5_PROPOSTA.md) | Texto para o Scrum Master registrar a ampliação de escopo |

## Estrutura do repositório

| Pasta | Conteúdo |
|---|---|
| `goodwe-grid-smart/` | Frontend principal (porte do projeto Lovable): Console do operador e App do motorista, com login real, conectado ao backend e com reserva em simulação local |
| `backend/` | API FastAPI + SQLAlchemy (SQLite em desenvolvimento; Supabase/PostgreSQL via `DATABASE_URL`), servidor OCPP, medidor MODBUS e modelo de previsão |
| `supabase/` | Migrations SQL do schema (já aplicadas no projeto `chargegrid`, com RLS ligado) |
| `docs/` | Documentação de arquitetura e apresentação |
| `frontend/` | Primeira versão do frontend (rotas `/operador` e `/app`), mantida só como referência |
| `render.yaml` | Deploy do backend no Render (Docker) |

## Arquitetura

```
Carregador (OCPP 1.6J) ──────────┐
Medidor de energia (MODBUS TCP) ─┼─► Backend ChargeGrid (FastAPI) ─► Supabase / PostgreSQL
Adaptador GoodWe ────────────────┘     │ CSMS OCPP · máquina de estados da sessão
                                       │ previsão de demanda e preço · pagamento · assistente (Gemini)
                                       ▼
                         Frontend (React): App do motorista + Console do operador
```

O navegador **nunca** fala com o Supabase: só o backend acessa o banco, e os segredos (senha do banco, chave do Gemini, credenciais da GoodWe) existem apenas no `backend/.env`.

## O que é real, simulado e futuro

- 🟢 **Real:** API, banco, autenticação, máquina de estados, comprovantes, auditoria, protocolo OCPP 1.6J (validado pelo esquema oficial), protocolo MODBUS TCP, modelo de previsão calibrado com dados do grupo, assistente com Gemini.
- 🟠 **Simulado (sempre identificado na interface e na API):** o carregador (virtual, fala OCPP de verdade), o medidor de energia (virtual, fala MODBUS de verdade), o pagamento (sandbox), a telemetria GoodWe (campo `origem`) e a parte visual dos 8 carregadores do Dashboard no navegador.
- ⚪ **Futuro:** carregador físico da FIAP (mesmo protocolo: só muda o endereço), credenciais da GoodWe OpenAPI (o adaptador real é um esqueleto ainda não validado) e provedor de pagamento real.

## Máquina de estados da sessão

`backend/app/services/session_fsm.py` implementa o modelo booleano do `Sprint3_ChargeGrid_ComputerScience.docx`: `S = A·B·C + M` (energia) e `T = A·B·C·D + M` (trava do cabo), onde `A` = pagamento pré-autorizado, `B` = RFID, `C` = cabo, `D` = pagamento quitado e `M` = bypass de manutenção. A prova da tabela-verdade (32 combinações) está em `backend/tests/test_session_fsm.py`. O app (REST) e o carregador (OCPP) passam pelas **mesmas** regras (`services/session_ops.py`).

## Como rodar

```bash
# Backend (porta 8000)
cd backend
python -m venv .venv
./.venv/Scripts/activate           # Windows; Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env               # preencha DATABASE_URL etc. (veja o GUIA_DO_PROJETO.md)
uvicorn app.main:app --port 8000

# Frontend (porta 8080)
cd goodwe-grid-smart
npm install
cp .env.example .env               # VITE_API_URL=http://localhost:8000 (vazio = 100% simulado)
npm run dev
```

Para ver os carregadores virtuais e o medidor funcionando, ligue `OCPP_SIMULATOR=true` e `MODBUS_SIMULATOR=true` no `backend/.env`.

Contas de demonstração (`SEED_DEMO_DATA=true`): `operador@chargegrid.demo` e `motorista@chargegrid.demo`, senha `chargegrid123`, ou o botão "Entrar como demonstração" (`ALLOW_DEMO_LOGIN=true`). Depois da apresentação, desligue os dois no ambiente publicado.

Testes:

```bash
cd backend && pip install -r requirements-dev.txt && pytest   # roda em SQLite em memória, nunca toca o Supabase
cd goodwe-grid-smart && npm test
```

## Checklist "Meta recomendada para a próxima banca" (proposta, seção EXECUÇÃO)

- [x] Aplicação web com frontend e backend próprios.
- [x] Banco persistente com usuários, estações, carregadores e sessões (Supabase).
- [x] Fluxo de recarga demonstrável com estados e registro de eventos (inclui as mensagens OCPP).
- [x] Integração GoodWe com adaptador simulado documentado, pronto para trocar pelo real.
- [x] Camada comercial: preço por kWh (dinâmico, por modelo), pagamento sandbox, comprovante e dashboard do estabelecimento.
- [x] Demonstração que identifica sem ambiguidade o que é real, simulado e futuro.
- [x] Schema no Supabase (migrations com RLS) e configurações de deploy (`render.yaml`, `vercel.json`, `Dockerfile`).
- [ ] Publicação online (Vercel e Render): depende das contas do time.
- [ ] Integração SEMS+ somente leitura com credenciais reais: depende da autorização da FIAP/GoodWe (Etapa 0).
- [ ] Sincronização com o Lovable via GitHub.

## Próximos passos

1. Resolver as validações da Etapa 0 (credenciais da GoodWe OpenAPI, ficha técnica do carregador FIAP, mapa de registradores do medidor).
2. Publicar o backend no Render e o frontend na Vercel, apontando `VITE_API_URL` para a URL pública.
3. Trocar o pagamento sandbox por um provedor real em modo teste.
4. Mais dados reais de recarga (com hora do dia) para calibrar o formato horário do modelo.
