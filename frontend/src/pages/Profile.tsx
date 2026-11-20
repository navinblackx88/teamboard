import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "@/hooks/queries";
import { api, errorMessage } from "@/lib/api";
import { toast } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/Layout";
import { Field, PageSpinner, UserAvatar } from "@/components/common";

export default function Profile() {
  const { data } = useMe();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", avatarUrl: "", emailNotifications: true });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [busy, setBusy] = useState<"profile" | "pw" | null>(null);
  useEffect(() => { if (data) setF({ name: data.user.name, avatarUrl: data.user.avatarUrl ?? "", emailNotifications: data.user.emailNotifications }); }, [data]);
  if (!data) return <PageSpinner />;

  const save = async (body: object, kind: "profile" | "pw", ok: string) => {
    setBusy(kind);
    try { await api("/auth/me", { method: "PATCH", body }); await qc.invalidateQueries({ queryKey: ["me"] }); toast.success(ok); if (kind === "pw") setPw({ currentPassword: "", newPassword: "" }); }
    catch (e) { toast.error("Couldn't save", errorMessage(e)); } finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader title="Your profile" />
      <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
        <Card>
          <form className="contents" onSubmit={(e: FormEvent) => { e.preventDefault(); save({ name: f.name, avatarUrl: f.avatarUrl || null, emailNotifications: f.emailNotifications }, "profile", "Profile saved"); }}>
            <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-4">
              <UserAvatar className="row-span-2" user={{ ...data.user, name: f.name || data.user.name, avatarUrl: f.avatarUrl || null }} size={56} />
              <CardTitle>{data.user.email}</CardTitle>
              <CardDescription>{data.user.googleLinked ? "Google account linked" : "Email and password sign-in"}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Name" htmlFor="pf-name"><Input id="pf-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Avatar URL" htmlFor="pf-avatar"><Input id="pf-avatar" type="url" placeholder="https://…" value={f.avatarUrl} onChange={(e) => setF({ ...f, avatarUrl: e.target.value })} /></Field>
              <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div className="grid gap-1">
                  <Label htmlFor="pf-email">Email notifications</Label>
                  <p className="text-muted-foreground text-xs">Assignments, comments, @mentions and approaching deadlines. In-app notifications are always on.</p>
                </div>
                <Switch id="pf-email" checked={f.emailNotifications} onCheckedChange={(emailNotifications) => setF({ ...f, emailNotifications })} />
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t"><Button type="submit" disabled={busy === "profile"}>{busy === "profile" && <Spinner />}Save profile</Button></CardFooter>
          </form>
        </Card>
        <Card>
          <form className="contents" onSubmit={(e: FormEvent) => { e.preventDefault(); save(pw, "pw", "Password updated"); }}>
            <CardHeader><CardTitle>{data.user.hasPassword ? "Change password" : "Set a password"}</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              {data.user.hasPassword && <Field label="Current password" htmlFor="pw-cur"><Input id="pw-cur" type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>}
              <Field label="New password" htmlFor="pw-new" hint="At least 8 characters"><Input id="pw-new" type="password" autoComplete="new-password" minLength={8} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            </CardContent>
            <CardFooter className="justify-end border-t"><Button type="submit" disabled={busy === "pw"}>{busy === "pw" && <Spinner />}Update password</Button></CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
