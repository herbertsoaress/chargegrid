import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.models import PaymentMethod, PaymentStatus
from app.services import payments
from app.services.payments import PaymentConfigError, PaymentProvider, PaymentResult, SandboxProvider
from tests.conftest import expected_amount, free_charger_id, start_charging


class _Fake(PaymentProvider):
    """Provedor de teste: o resultado e escolhido por atributo de classe."""

    name = "fake"
    real = True
    outcome = PaymentStatus.aprovado
    calls: list = []

    def charge(self, *, session_id, method, amount):
        type(self).calls.append((session_id, method, amount))
        return PaymentResult(type(self).outcome, f"FAKE-{session_id}")


@pytest.fixture()
def fake_provider(monkeypatch):
    _Fake.outcome = PaymentStatus.aprovado
    _Fake.calls = []
    monkeypatch.setitem(payments.PROVIDERS, "fake", _Fake)
    monkeypatch.setattr(settings, "payment_provider", "fake")
    return _Fake


# ---------------- provedor sandbox (padrao) ----------------
def test_sandbox_is_the_default_and_never_real():
    provider = payments.get_provider()
    assert isinstance(provider, SandboxProvider) and provider.name == "sandbox" and provider.real is False
    result = provider.charge(session_id=7, method=PaymentMethod.pix, amount=12.3)
    assert result.status == PaymentStatus.aprovado and result.provider_ref == "SANDBOX-PIX-7"
    assert provider.charge(session_id=7, method=PaymentMethod.cartao, amount=1).provider_ref == "SANDBOX-CARTAO-7"


def test_unknown_provider_is_reported_clearly(monkeypatch):
    monkeypatch.setattr(settings, "payment_provider", "mercadopago")
    with pytest.raises(PaymentConfigError, match="mercadopago.*sandbox"):
        payments.get_provider()


def test_backend_refuses_to_start_with_an_unknown_provider(monkeypatch):
    monkeypatch.setattr(settings, "payment_provider", "inexistente")
    with pytest.raises(PaymentConfigError):
        with TestClient(app):
            pass


def test_health_reports_the_payment_provider(client, monkeypatch):
    assert client.get("/health").json()["payments"] == {"provider": "sandbox", "real": False}
    monkeypatch.setitem(payments.PROVIDERS, "fake", _Fake)
    monkeypatch.setattr(settings, "payment_provider", "fake")
    assert client.get("/health").json()["payments"] == {"provider": "fake", "real": True}


# ---------------- fluxo padrao continua igual ----------------
def test_default_flow_still_produces_a_sandbox_receipt(client, driver_headers):
    session = start_charging(client, driver_headers, free_charger_id(client, driver_headers))
    payment = client.post(f"/sessions/{session['id']}/pay", json={"method": "pix"}, headers=driver_headers).json()
    assert payment["status"] == "aprovado" and payment["provider_ref"] == f"SANDBOX-PIX-{session['id']}"
    receipt = client.get(f"/sessions/{session['id']}/receipt", headers=driver_headers).json()
    assert receipt["origem"] == "sandbox" and "sandbox" in receipt["aviso"]


# ---------------- trocar de provedor: o resto do sistema nao muda ----------------
def test_pay_delegates_to_the_configured_provider(client, driver_headers, fake_provider):
    session = start_charging(client, driver_headers, free_charger_id(client, driver_headers))
    payment = client.post(f"/sessions/{session['id']}/pay", json={"method": "cartao"}, headers=driver_headers)
    assert payment.status_code == 200 and payment.json()["provider_ref"] == f"FAKE-{session['id']}"
    assert fake_provider.calls[0][:2] == (session["id"], PaymentMethod.cartao)

    after = client.get(f"/sessions/{session['id']}", headers=driver_headers).json()
    assert after["payment_finalized"] and after["lock_released"]  # aprovado => D=1 e trava liberada
    receipt = client.get(f"/sessions/{session['id']}/receipt", headers=driver_headers).json()
    assert receipt["origem"] == "fake" and "sandbox" not in receipt["aviso"]  # provedor real: sem o aviso de teste


def test_refused_payment_returns_402_and_keeps_the_session_open(client, driver_headers, fake_provider):
    fake_provider.outcome = PaymentStatus.recusado
    session = start_charging(client, driver_headers, free_charger_id(client, driver_headers))
    response = client.post(f"/sessions/{session['id']}/pay", json={"method": "pix"}, headers=driver_headers)
    assert response.status_code == 402 and "recusado" in response.json()["detail"]

    after = client.get(f"/sessions/{session['id']}", headers=driver_headers).json()
    assert not after["payment_finalized"] and not after["lock_released"] and after["ended_at"] is None
    assert client.get(f"/sessions/{session['id']}/receipt", headers=driver_headers).status_code == 409  # sem comprovante

    fake_provider.outcome = PaymentStatus.aprovado  # tenta de novo e passa
    assert client.post(f"/sessions/{session['id']}/pay", json={"method": "pix"}, headers=driver_headers).status_code == 200


def test_pending_payment_does_not_release_the_cable_lock(client, driver_headers, fake_provider):
    fake_provider.outcome = PaymentStatus.pendente
    session = start_charging(client, driver_headers, free_charger_id(client, driver_headers))
    response = client.post(f"/sessions/{session['id']}/pay", json={"method": "pix"}, headers=driver_headers)
    assert response.status_code == 200 and response.json()["status"] == "pendente"
    after = client.get(f"/sessions/{session['id']}", headers=driver_headers).json()
    assert not after["payment_finalized"] and not after["lock_released"]
    assert client.post(f"/sessions/{session['id']}/stop", headers=driver_headers).status_code == 409  # trava fechada
    events = client.get(f"/sessions/{session['id']}/events", headers=driver_headers).json()
    assert any(e["type"] == "payment_pendente" and e["payload_json"]["provider"] == "fake" for e in events)


# ---------------- valor final = energia final x preco travado ----------------
def _bump_energy_after_payment(db_factory, session_id, extra_kwh):
    """Simula uma leitura do medidor que estava a caminho e foi gravada junto com o pagamento."""
    from app.models import ChargingSession

    db = db_factory()
    row = db.get(ChargingSession, session_id)
    row.energy_kwh = round(row.energy_kwh + extra_kwh, 3)
    db.commit()
    db.close()


def _pay_bump_and_stop(client, db_factory, headers, extra_kwh):
    session = start_charging(client, headers, free_charger_id(client, headers))
    sid = session["id"]
    client.post(f"/sessions/{sid}/meter-values", json={"energy_kwh": 10.0, "power_kw": 11.0}, headers=headers)
    paid = client.post(f"/sessions/{sid}/pay", json={"method": "pix"}, headers=headers).json()
    if extra_kwh:
        _bump_energy_after_payment(db_factory, sid, extra_kwh)
    stopped = client.post(f"/sessions/{sid}/stop", headers=headers)
    assert stopped.status_code == 200, stopped.text
    return sid, paid, stopped.json()


def test_final_amount_follows_the_final_energy_in_sandbox(client, db_factory, driver_headers):
    sid, paid, stopped = _pay_bump_and_stop(client, db_factory, driver_headers, extra_kwh=0.7)
    price = stopped["price_per_kwh_snapshot"]
    assert paid["amount"] == expected_amount(10.0, price)
    assert stopped["energy_kwh"] == 10.7
    final = expected_amount(10.7, price)
    assert stopped["amount_due"] == final
    receipt = client.get(f"/sessions/{sid}/receipt", headers=driver_headers).json()
    assert receipt["amount"] == final
    assert receipt["payment"]["amount"] == receipt["amount"]  # o pagamento de teste acompanha o valor final
    events = client.get(f"/sessions/{sid}/events", headers=driver_headers).json()
    adjusted = [e for e in events if e["type"] == "amount_adjusted"]
    assert len(adjusted) == 1
    assert adjusted[0]["payload_json"] == {
        "previous": paid["amount"],
        "final": final,
        "energy_kwh": 10.7,
        "to_reconcile": False,
    }


def test_no_adjustment_when_nothing_changed_after_payment(client, db_factory, driver_headers):
    sid, paid, stopped = _pay_bump_and_stop(client, db_factory, driver_headers, extra_kwh=0)
    assert stopped["amount_due"] == paid["amount"]
    events = client.get(f"/sessions/{sid}/events", headers=driver_headers).json()
    assert not [e for e in events if e["type"] == "amount_adjusted"]


def test_real_provider_charge_is_never_rewritten_only_flagged(client, db_factory, driver_headers, fake_provider):
    sid, paid, stopped = _pay_bump_and_stop(client, db_factory, driver_headers, extra_kwh=0.7)
    receipt = client.get(f"/sessions/{sid}/receipt", headers=driver_headers).json()
    assert receipt["payment"]["amount"] == paid["amount"]  # o que foi cobrado continua igual
    assert stopped["amount_due"] > paid["amount"]
    events = client.get(f"/sessions/{sid}/events", headers=driver_headers).json()
    adjusted = [e for e in events if e["type"] == "amount_adjusted"][0]
    assert adjusted["payload_json"]["to_reconcile"] is True
