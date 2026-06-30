import { useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

const LIME = "#cdfa46";

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setError(
        code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")
          ? "Email o contraseña incorrectos."
          : code.includes("too-many-requests")
          ? "Demasiados intentos. Esperá un momento."
          : "No se pudo iniciar sesión. Revisá tu conexión.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] p-6 text-[#f4f4f7]">
      <div
        className="w-full max-w-sm rounded-[22px] border border-[#24242e] p-7"
        style={{ background: "linear-gradient(135deg,#15151d 0%,#101016 100%)" }}
      >
        <div className="mb-5 flex items-center gap-3">
          <div
            className="flex size-10 items-center justify-center rounded-xl"
            style={{ background: "radial-gradient(120% 120% at 30% 20%,rgba(205,250,70,.22),rgba(205,250,70,.05))", border: "1px solid rgba(205,250,70,.28)" }}
          >
            <Lock className="size-5" style={{ color: LIME }} />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Octopus Finance</h1>
            <p className="text-[12px] text-[#8a8a96]">Ingresá para ver tus finanzas</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[12px] text-[#9a9aa6]">Email</label>
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.cl" required data-testid="login-email" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] text-[#9a9aa6]">Contraseña</label>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required data-testid="login-password" />
          </div>
          {error ? <p className="text-[12.5px] text-[#f0676b]" data-testid="login-error">{error}</p> : null}
          <Button type="submit" disabled={loading} className="w-full font-bold" data-testid="login-submit">
            {loading ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}

/** Portón de autenticación: nada se ve ni se consulta a la base sin sesión iniciada. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] text-[#8a8a96]">
        <div className="size-6 animate-spin rounded-full border-2 border-[#24242e] border-t-[#cdfa46]" />
      </div>
    );
  }
  if (!user) return <LoginScreen />;
  return <>{children}</>;
}
