from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Role, User
from app.schemas import DemoLoginRequest, LoginRequest, MeOut, SignupRequest, TokenResponse
from app.security import create_access_token, get_current_user, hash_password, login_throttle, verify_password
from app.seed import DEMO_DRIVER_EMAIL, DEMO_OPERATOR_EMAIL

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_for(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id, user.role), role=user.role, name=user.name, user_id=user.id
    )


@router.post("/signup", response_model=TokenResponse)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="E-mail ja cadastrado")
    # O papel NAO vem do cliente: so e-mails listados em OPERATOR_EMAILS viram operador.
    role = Role.operator if email in settings.operator_email_set else Role.driver
    user = User(name=payload.name, email=email, password_hash=hash_password(payload.password), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _token_for(user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    email = payload.email.lower()
    key = f"{email}|{request.client.host if request.client else '-'}"
    if login_throttle.blocked(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas tentativas de login. Aguarde alguns minutos e tente de novo.",
        )
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        login_throttle.register_failure(key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="E-mail ou senha invalidos")
    login_throttle.reset(key)
    return _token_for(user)


@router.post("/demo-login", response_model=TokenResponse)
def demo_login(payload: DemoLoginRequest, db: Session = Depends(get_db)):
    """Entra como a conta de demonstracao (sem senha). So existe se ALLOW_DEMO_LOGIN=true."""
    if not settings.allow_demo_login:
        raise HTTPException(status_code=404, detail="Login de demonstracao desativado")
    email = DEMO_OPERATOR_EMAIL if payload.role == Role.operator else DEMO_DRIVER_EMAIL
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Conta de demonstracao nao existe (SEED_DEMO_DATA=false?)")
    return _token_for(user)


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user)):
    return user
