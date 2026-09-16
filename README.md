# ChargeGrid

Protótipo full-stack do ChargeGrid, construído a partir da `ChargeGrid_Proposta_de_Evolucao_Tecnica.pdf`
(Challenge FIAP 2026 | GoodWe Brasil) e das entregas das Sprints anteriores (estatística/regressão,
cálculo integral, lógica booleana do ESP32 e o MVP visual publicado no Lovable em
`goodwe-grid-smart.lovable.app`).

O SEMS+ continua sendo a camada de gestão energética da GoodWe. O ChargeGrid acrescenta a camada
comercial: cadastro de motoristas e estações, sessões de recarga, tarifação dinâmica, pagamento e
faturamento.

## Por que este projeto é novo e local (e não uma edição direta do Lovable)

Não há credenciais da GoodWe OpenAPI nem acesso à conta/API do Lovable usado para publicar
`goodwe-grid-smart.lovable.app`. Por isso este repositório reconstrói o frontend (mesmo stack:
React + Vite + Tailwind, replicando o Console do Operador e o App do Motorista observados no site
publicado) e adiciona o backend que faltava. Conforme a própria proposta recomenda (`docs.lovable.dev/integrations/github`),
depois de revisado este projeto pode ser importado de volta ao Lovable via GitHub.

## Arquitetura

```
Equipamentos GoodWe -> SEMS+ (gestao energetica) -> GoodWe OpenAPI (dados autorizados)
                                                            |
                                                   Backend ChargeGrid (Python/FastAPI)
                                                    /                          \
                                       PostgreSQL/SQLite                 Pagamento sandbox
                                                            |
                                        Frontend ChargeGrid (React, originado no Lovable)
```

| Camada | Tecnologia | Pasta |
|---|---|---|
| Interface | React + Vite + TypeScript + Tailwind | `frontend/` |
| API | Python + FastAPI | `backend/app` |
| Dados | SQLite por padrão (troca para Postgres/Supabase via `DATABASE_URL`) | `backend/app/db.py` |
| Integração | Adaptador GoodWe (simulado por padrão, real via credenciais) | `backend/app/services/goodwe_adapter.py` |
| Publicação | Vercel (frontend) + Render/Railway (backend) — configs a preparar quando for publicar | - |

## O que é real, o que é simulado

- **Real**: toda a jornada de sessão (máquina de estados, banco de dados, autenticação, faturamento,
  eventos) roda de ponta a ponta contra o backend — nada é mocado no componente React.
- **Simulado, e sempre identificado como tal** (badge "Dados simulados" na interface e campo
  `origem` nas respostas da API): telemetria GoodWe, curva de balanceamento solar/bateria/rede e a
  aprovação de pagamento (sandbox PIX/Cartão). Isso segue à risca o risco "exposição de dados
  operacionais / ambiguidade real vs. simulado" listado na proposta.
- O adaptador GoodWe muda para o modo real automaticamente assim que `GOODWE_APP_ID` e
  `GOODWE_APP_SECRET` forem definidos no `.env` do backend (ver `backend/.env.example`) — nenhuma
  mudança de código é necessária.

## Máquina de estados da sessão

Implementada em `backend/app/services/session_fsm.py`, replica literalmente o modelo booleano
provado no `Sprint3_ChargeGrid_ComputerScience.docx` (ChargeGrid Auth System / ESP32):

- `S` (liberação de potência) = `A·B·C + M`
- `T` (liberação da trava do cabo) = `A·B·C·D + M` (forma simplificada, equivalente à original
  `A·B·C·D + M·D + M` pela Lei da Absorção — prova reproduzida em `backend/tests/test_session_fsm.py`
  com as 32 combinações da tabela-verdade).

Onde `A` = pagamento confirmado, `B` = RFID autenticado, `C` = cabo conectado, `M` = bypass de
manutenção, `D` = pagamento finalizado.

## Como rodar

### Backend

```bash
cd backend
python -m venv .venv
./.venv/Scripts/activate        # Windows; no Linux/Mac: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
pytest                          # roda a prova da tabela-verdade + fluxo de sessao ponta-a-ponta
```

Na primeira subida o banco é criado e populado com dados de demonstração: duas estações
(ChargeGrid Intelligence e EV ChargeOps), cinco carregadores, um usuário operador e um motorista.

- Operador: `operador@chargegrid.demo` / `chargegrid123`
- Motorista: `motorista@chargegrid.demo` / `chargegrid123`

### Frontend

```bash
cd frontend
npm install
cp .env.example .env            # VITE_API_URL aponta para o backend
npm run dev
```

Acesse `http://localhost:5173`.

## Checklist "Meta recomendada para a próxima banca" (proposta, seção EXECUÇÃO)

- [x] Aplicação web com frontend e backend próprios.
- [x] Banco persistente com usuários, estações, carregadores e sessões.
- [x] Fluxo de recarga demonstrável com estados e registro de eventos (`SessionEvent`, exibido em
      Engenharia > Logs OCPP).
- [x] Integração GoodWe com adaptador simulado documentado, pronto para trocar para leitura real
      quando as credenciais forem concedidas.
- [x] Camada comercial: preço por kWh dinâmico, pagamento em ambiente sandbox, faturamento e
      dashboard do estabelecimento.
- [x] Demonstração que identifica sem ambiguidade o que é real, simulado e futuro (badges na UI +
      campo `origem` na API).
- [ ] Publicação online (Vercel/Render) e sincronização com o Lovable via GitHub — depende de contas
      do time, não incluído neste commit.
- [ ] Integração SEMS+ somente leitura com credenciais reais — depende da autorização da FIAP/GoodWe
      (Etapa 0 da proposta).

## Próximos passos

1. Resolver as validações da Etapa 0 da proposta (autorização de acesso à GoodWe OpenAPI,
   confirmação de carregador vinculado à conta SEMS+ da FIAP).
2. Publicar `backend/` no Render/Railway e `frontend/` na Vercel; apontar `VITE_API_URL` para a URL
   pública do backend.
3. Criar um repositório no GitHub a partir deste projeto e importar no Lovable
   (`docs.lovable.dev/integrations/github`) para continuar a evolução visual por lá.
