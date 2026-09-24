import { useState } from "react";
import { MobileSplash } from "./MobileSplash";
import { MobileLogin, type AuthMode } from "./MobileLogin";
import { MobileHome } from "./MobileHome";
import { MobileMap } from "./MobileMap";
import { MobileChargerDetail } from "./MobileChargerDetail";
import { MobileCharging } from "./MobileCharging";
import { MobileHistory } from "./MobileHistory";
import { MobilePricing } from "./MobilePricing";
import { MobileProfile } from "./MobileProfile";
import { MobileSessionSetup } from "./MobileSessionSetup";
import { LiveDataProvider, useLiveData } from "@/components/dashboard/LiveDataProvider";

function MobileAppInner() {
  const [screen, setScreen] = useState("splash");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [selectedChargerId, setSelectedChargerId] = useState<string | null>(null);
  const { backend } = useLiveData();

  // Com o backend ligado, o app pede login/cadastro. Sem backend (ou se ele cair) segue em modo simulado.
  const startAuth = (mode: AuthMode) => {
    if (!backend.enabled || backend.driver) return setScreen("home");
    setAuthMode(mode);
    setScreen("auth");
  };

  const openCharger = (id: string) => {
    setSelectedChargerId(id);
    setScreen("chargerDetail");
  };

  const renderScreen = () => {
    switch (screen) {
      case "splash":
        return <MobileSplash onLogin={() => startAuth("login")} onSignup={() => startAuth("signup")} />;
      case "auth":
        return <MobileLogin mode={authMode} onModeChange={setAuthMode} onDone={() => setScreen("home")} onBack={() => setScreen("splash")} />;
      case "home":
        return <MobileHome onNavigate={setScreen} onSelectCharger={openCharger} />;
      case "map":
        return <MobileMap onNavigate={setScreen} onSelectCharger={openCharger} />;
      case "chargerDetail":
        return <MobileChargerDetail chargerId={selectedChargerId} onBack={() => setScreen("home")} onNavigate={setScreen} />;
      case "sessionSetup":
        return <MobileSessionSetup chargerId={selectedChargerId} onBack={() => setScreen("chargerDetail")} onStarted={() => setScreen("charging")} />;
      case "charging":
        return <MobileCharging chargerId={selectedChargerId} onBack={() => setScreen("home")} />;
      case "history":
        return <MobileHistory onBack={() => setScreen("home")} onNavigate={setScreen} />;
      case "pricing":
        return <MobilePricing onBack={() => setScreen("home")} />;
      case "profile":
        return <MobileProfile onBack={() => setScreen("home")} onNavigate={setScreen} onLogout={() => setScreen("splash")} />;
      default:
        return <MobileHome onNavigate={setScreen} onSelectCharger={openCharger} />;
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className="phone-frame bg-background relative">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-background rounded-b-2xl z-10 flex items-center justify-center">
          <div className="w-12 h-1.5 bg-muted rounded-full" />
        </div>
        <div className="h-full pt-6 overflow-hidden">
          {renderScreen()}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-3">App Móvel — Toque para navegar</p>
    </div>
  );
}

export function MobileApp() {
  return (
    <LiveDataProvider>
      <MobileAppInner />
    </LiveDataProvider>
  );
}
