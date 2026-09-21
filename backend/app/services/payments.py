"""Camada de pagamentos: um "provedor" cobra a sessao e devolve o resultado.

HOJE existe um unico provedor, o `SandboxProvider`: aprovacao simulada instantanea, nenhuma cobranca
real (Etapa 4 da proposta: "pagamento em ambiente de testes"). O resto do sistema (rota /pay, comprovante,
maquina de estados) so conversa com a interface `PaymentProvider`, entao trocar por um provedor real
(Mercado Pago, Stripe...) e escrever UMA classe nova e registra-la em `PROVIDERS`:

    class MeuProvedor(PaymentProvider):
        name = "meu-provedor"
        real = True
        def charge(self, *, session_id, method, amount) -> PaymentResult:
            ...  # chamar a API do provedor com as chaves de settings (variaveis de ambiente do backend)
            return PaymentResult(PaymentStatus.aprovado | pendente | recusado, "referencia-do-provedor")

    PROVIDERS["meu-provedor"] = MeuProvedor      # e PAYMENT_PROVIDER=meu-provedor no .env

Resultados possiveis (`PaymentStatus`):
  * aprovado  -> a rota /pay finaliza o pagamento (D = 1) e libera a trava do cabo;
  * pendente  -> o pagamento foi criado mas ainda nao confirmado (ex.: PIX aguardando): a sessao NAO
                 e finalizada e o motorista pode chamar /pay de novo;
  * recusado  -> HTTP 402; a sessao continua aberta.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.config import settings
from app.models import PaymentMethod, PaymentStatus


class PaymentConfigError(RuntimeError):
    """PAYMENT_PROVIDER aponta para um provedor que nao existe."""


@dataclass(frozen=True)
class PaymentResult:
    status: PaymentStatus
    provider_ref: str


class PaymentProvider(ABC):
    name: str
    real: bool  # False = nada e cobrado de verdade (sandbox)

    @abstractmethod
    def charge(self, *, session_id: int, method: PaymentMethod, amount: float) -> PaymentResult:
        """Cobra `amount` (R$) da sessao com o metodo escolhido."""


class SandboxProvider(PaymentProvider):
    """Aprova tudo na hora, sem chamar nenhum servico externo."""

    name = "sandbox"
    real = False

    def charge(self, *, session_id: int, method: PaymentMethod, amount: float) -> PaymentResult:
        return PaymentResult(PaymentStatus.aprovado, f"SANDBOX-{method.value.upper()}-{session_id}")


PROVIDERS: dict[str, type[PaymentProvider]] = {"sandbox": SandboxProvider}


def get_provider() -> PaymentProvider:
    name = settings.payment_provider.strip().lower()
    try:
        return PROVIDERS[name]()
    except KeyError:
        raise PaymentConfigError(
            f"PAYMENT_PROVIDER='{settings.payment_provider}' nao existe. Opcoes: {', '.join(sorted(PROVIDERS))}."
        ) from None
