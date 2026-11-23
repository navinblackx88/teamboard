import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, MailCheck, SquareKanban } from "lucide-react";
import { api, API_URL, errorMessage } from "@/lib/api";
import { ROLE_LABEL, type Me, type Role } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { useUi } from "@/stores/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Field, PageSpinner } from "@/components/common";

type AuthRes = { user: Me; accessToken: string; refreshToken: string; joinedWorkspaceId?: string };

function Shell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="bg-muted flex min-h-full items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md"><SquareKanban className="size-4" /></span>
          <span className="text-lg tracking-tight">TeamBoard</span>
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{title}</CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </CardHeader>
          {children && <CardContent>{children}</CardContent>}
        </Card>
        {footer && <p className="text-muted-foreground text-center text-sm">{footer}</p>}
      </div>
    </div>
  );
}

const FormError = ({ children }: { children: ReactNode }) => (
  <Alert variant="destructive"><AlertCircle /><AlertDescription>{children}</AlertDescription></Alert>
);

const useProviders = () => useQuery({ queryKey: ["providers"], queryFn: () => api<{ google: boolean }>("/auth/providers"), staleTime: Infinity });

function GoogleButton({ inviteToken }: { inviteToken?: string }) {
  const { data } = useProviders();
  if (!data?.google) return null;
  const href = `${API_URL}/api/v1/auth/google${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ""}`;
  return (
    <>
      <Button variant="outline" className="w-full" asChild>
        <a href={href}>
          <svg viewBox="0 0 48 48" className="size-4" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Continue with Google
        </a>
      </Button>
      <div className="after:border-border relative my-5 text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
        <span className="bg-card text-muted-foreground relative z-10 px-2">Or continue with email</span>
      </div>
    </>
  );
}

function useFinishAuth() {
  const setTokens = useAuth((s) => s.setTokens);
  const setWorkspace = useUi((s) => s.setWorkspace);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (r: { accessToken: string; refreshToken: string; joinedWorkspaceId?: string }) => {
    qc.clear();
    setTokens(r.accessToken, r.refreshToken);
    if (r.joinedWorkspaceId) setWorkspace(r.joinedWorkspaceId);
    navigate(params.get("next") || "/dashboard", { replace: true });
  };
}

const TextLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link className="text-primary font-medium underline-offset-4 hover:underline" to={to}>{children}</Link>
);

export function Login() {
  const finish = useFinishAuth();
  const [params] = useSearchParams();
  const token = useAuth((s) => s.accessToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (token && !params.get("invite")) return <Navigate to="/dashboard" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { finish(await api<AuthRes>("/auth/login", { body: { email, password, inviteToken: params.get("invite") ?? undefined } })); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Shell title="Welcome back" subtitle="Sign in to your workspace" footer={<>New here? <TextLink to={`/signup${window.location.search}`}>Create an account</TextLink></>}>
      <GoogleButton inviteToken={params.get("invite") ?? undefined} />
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" className="w-full" disabled={busy}>{busy && <Spinner />}Sign in</Button>
      </form>
    </Shell>
  );
}

export function Signup() {
  const finish = useFinishAuth();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ name: "", email: params.get("email") ?? "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { finish(await api<AuthRes>("/auth/signup", { body: { ...form, inviteToken: params.get("invite") ?? undefined } })); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Shell title="Create your account" subtitle="Start managing projects with your team" footer={<>Already have an account? <TextLink to={`/login${window.location.search}`}>Sign in</TextLink></>}>
      <GoogleButton inviteToken={params.get("invite") ?? undefined} />
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Full name" htmlFor="name"><Input id="name" autoComplete="name" required value={form.name} onChange={set("name")} /></Field>
        <Field label="Work email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} readOnly={!!params.get("email")} /></Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters"><Input id="password" type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={set("password")} /></Field>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" className="w-full" disabled={busy}>{busy && <Spinner />}Create account</Button>
      </form>
    </Shell>
  );
}

/** Google OAuth lands here with tokens in the URL fragment. */
export function AuthCallback() {
  const finish = useFinishAuth();
  const [error, setError] = useState("");
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, "", window.location.pathname); // drop tokens from the address bar
    if (h.get("error")) setError(h.get("error")!);
    else if (h.get("access") && h.get("refresh")) finish({ accessToken: h.get("access")!, refreshToken: h.get("refresh")!, joinedWorkspaceId: h.get("workspace") ?? undefined });
    else setError("Sign-in response was incomplete.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!error) return <PageSpinner />;
  return <Shell title="Sign-in failed" subtitle={error}><Button variant="outline" className="w-full" asChild><Link to="/login">Back to sign in</Link></Button></Shell>;
}

type InvitePreview = { workspaceName: string; invitedByName: string; email: string; role: Role; status: "pending" | "accepted" | "expired" };

export function AcceptInvite() {
  const { token = "" } = useParams();
  const signedIn = useAuth((s) => !!s.accessToken);
  const setWorkspace = useUi((s) => s.setWorkspace);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = useQuery({ queryKey: ["invite", token], queryFn: () => api<InvitePreview>(`/invitations/${token}`), retry: false });

  if (preview.isLoading) return <PageSpinner />;
  if (preview.error || !preview.data) return <Shell title="Invitation not found" subtitle="This link is invalid. Ask your admin for a new one." />;
  const inv = preview.data;
  if (inv.status !== "pending") {
    return (
      <Shell title={inv.status === "expired" ? "Invitation expired" : "Invitation already used"} subtitle="Ask a workspace admin to send a new invitation.">
        <Button variant="outline" className="w-full" asChild><Link to="/login">Go to sign in</Link></Button>
      </Shell>
    );
  }

  const accept = async () => {
    setBusy(true); setError("");
    try {
      const r = await api<{ workspaceId: string }>(`/invitations/${token}/accept`, { method: "POST" });
      setWorkspace(r.workspaceId);
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/dashboard");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const q = `?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(inv.email)}`;
  return (
    <Shell title={`Join ${inv.workspaceName}`} subtitle={<>{inv.invitedByName} invited <b>{inv.email}</b> to join as <b>{ROLE_LABEL[inv.role]}</b>.</>}>
      <div className="text-primary mb-5 flex justify-center"><MailCheck className="size-10" /></div>
      {error && <div className="mb-3"><FormError>{error}</FormError></div>}
      {signedIn
        ? <Button className="w-full" disabled={busy} onClick={accept}>{busy && <Spinner />}Accept invitation</Button>
        : <div className="grid gap-2">
            <Button className="w-full" asChild><Link to={`/signup${q}`}>Create account & join</Link></Button>
            <Button variant="outline" className="w-full" asChild><Link to={`/login${q}`}>I already have an account</Link></Button>
          </div>}
    </Shell>
  );
}

export function Onboarding() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setWorkspace = useUi((s) => s.setWorkspace);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ws = await api<{ id: string }>("/workspaces", { body: { name } });
      setWorkspace(ws.id);
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/projects?new=1");
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Shell title="Create a workspace" subtitle="A workspace holds your team's projects. You'll be its admin." footer={<Link to="/dashboard" className="hover:text-foreground underline-offset-4 hover:underline">Back to the app</Link>}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Workspace name" htmlFor="ws-name"><Input id="ws-name" required maxLength={120} placeholder="e.g. Acme Engineering" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" className="w-full" disabled={busy}>{busy && <Spinner />}Create workspace</Button>
      </form>
    </Shell>
  );
}
