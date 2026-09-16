import type { Role } from "./types";

const TOKEN_KEY = "chargegrid_token";
const ROLE_KEY = "chargegrid_role";
const NAME_KEY = "chargegrid_name";
const USER_ID_KEY = "chargegrid_user_id";

export function saveSession(token: string, role: Role, name: string, userId: number) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
  localStorage.setItem(NAME_KEY, name);
  localStorage.setItem(USER_ID_KEY, String(userId));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(USER_ID_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRole(): Role | null {
  return localStorage.getItem(ROLE_KEY) as Role | null;
}

export function getName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

export function isAuthenticated(): boolean {
  return Boolean(getToken());
}
