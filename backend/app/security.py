import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Role, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


class LoginThrottle:
    """Limite de tentativas de login FALHAS por (e-mail, IP): protege contra adivinhacao de senha.

    Em memoria (zera ao reiniciar o servidor). Um login correto zera o contador daquela chave.
    """

    def __init__(self, max_failures: int = 5, window_seconds: int = 300):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> deque[float]:
        failures = self._failures[key]
        while failures and now - failures[0] > self.window_seconds:
            failures.popleft()
        return failures

    def blocked(self, key: str, now: float | None = None) -> bool:
        return len(self._prune(key, time.monotonic() if now is None else now)) >= self.max_failures

    def register_failure(self, key: str, now: float | None = None) -> None:
        moment = time.monotonic() if now is None else now
        self._prune(key, moment).append(moment)

    def reset(self, key: str | None = None) -> None:
        if key is None:
            self._failures.clear()
        else:
            self._failures.pop(key, None)


login_throttle = LoginThrottle()


def create_access_token(user_id: int, role: Role) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "role": role.value, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def _user_from_token(token: str | None, db: Session) -> User | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        return None
    return db.get(User, user_id)


def get_current_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    user = _user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais invalidas")
    return user


def get_current_user_optional(
    token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User | None:
    return _user_from_token(token, db)


def require_operator(user: User = Depends(get_current_user)) -> User:
    if user.role != Role.operator:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso restrito ao operador")
    return user
