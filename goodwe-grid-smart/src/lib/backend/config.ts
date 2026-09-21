// URL do backend FastAPI. Definida em ".env" (VITE_API_URL). Vazia = modo 100% simulado
// (o app continua funcionando sozinho, sem servidor e sem Supabase).
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/$/, "");

export const backendEnabled: boolean = API_URL.length > 0;
