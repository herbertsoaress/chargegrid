# Pontuação de fidelidade (motorista)

**Extensão aprovada pelo grupo**, fora do playbook da GoodWe e da Proposta de Evolução Técnica original
(ver [`ETAPA_5_PROPOSTA.md`](ETAPA_5_PROPOSTA.md)). Pensada para **atrair e manter cliente** no local,
do mesmo jeito que programas de fidelidade de posto de combustível (Petrobras Premmia, Shell Box):
pontos por consumo e por regularidade, com faixas e um selo. **Hoje é só visual — não dá desconto.**

Código: `backend/app/services/loyalty.py`. Endpoint: `GET /users/me/loyalty` (motorista, exige login).
Testes: `backend/tests/test_loyalty.py`.

## 1. Por que estes dois critérios (e não outros)

- **Consumo (kWh):** é justo e imparcial — não depende de quanto o cliente pagou, então não premia
  quem carrega em horário de pico só porque pagou mais caro (isso premiaria o comportamento errado).
- **Regularidade (sessões por semana):** mede fidelidade ao local, não só volume — é o que de fato
  "atrai e mantém" um cliente frente à concorrência.
- **Indicação de amigos** foi cogitada e descartada por ora: exigiria um sistema de convites e
  proteção contra contas falsas, desproporcional ao tamanho desta extensão. Fica como ideia futura.
- **Não é ligada ao horário de pico:** já existe o preço dinâmico para isso; dar pontos por carregar
  fora de ponta seria premiar duas vezes a mesma coisa.

## 2. Fórmula

```
pontos = (kWh entregues em TODAS as sessões encerradas do motorista) × 10
       + (número de semanas em que ele bateu a meta) × 50

meta da semana = 3 ou mais sessões encerradas na mesma semana ISO (segunda a domingo, horário de Brasília)
```

Os pontos são **sempre calculados na hora**, lendo as sessões do banco — não existe uma "carteira"
separada que possa dessincronizar. Uma vez ganho, o bônus de uma semana **não é perdido** depois
(mesmo que, olhando para trás, aquela semana pareça distante).

### Faixas (selo)

| Faixa | Pontos mínimos |
|---|---|
| 🥉 Bronze | 0 |
| 🥈 Prata | 500 |
| 🥇 Ouro | 2.000 |

500 pontos ≈ 50 kWh (ou menos, contando os bônus semanais) — o suficiente para aparecer depois de
algumas semanas de uso normal.

## 3. Onde aparece

- **App do motorista → Perfil:** cartão com o total de pontos, o selo da faixa, quantos pontos faltam
  para a próxima e a barra da meta da semana (quantas sessões já fez das 3 necessárias).
- **Assistente com IA:** responde "quantos pontos eu tenho" e "como chego ao próximo nível" usando os
  mesmos dados (regra 14 de `services/llm.py`).

## 4. Exemplo verificado

Um motorista novo, sem sessões: 0 pontos, faixa Bronze, faltam 500 para a Prata.
Depois de 3 sessões na mesma semana totalizando 20 kWh: `20 × 10 + 1 × 50 = 250` pontos, meta da semana
batida (+50), ainda em Bronze (faltam 250 para a Prata). Isso foi conferido rodando o backend de
verdade, não só no papel.

## 5. Limites

- Só existe para contas de motorista (o console do operador não tem pontuação).
- Não há desconto real hoje — é só visual. Se o grupo quiser oferecer desconto por faixa no futuro,
  a extensão de tarifação por tempo/potência (`TARIFA_TEMPO_E_OCIOSIDADE.md`) já mostra onde esse
  desconto entraria no cálculo do valor final.
- Como todo cálculo é feito na hora a partir do histórico, o "peso" de cada sessão nunca muda
  depois — mas também não existe um teto de pontos por sessão contra abuso (não é um problema para a
  demonstração, mas seria uma extensão futura antes de um uso real).
