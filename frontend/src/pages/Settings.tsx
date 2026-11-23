import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentWorkspaceId, useMe, useWorkspace, useWorkspaceMutations } from "@/hooks/queries";
import { api, errorMessage } from "@/lib/api";
import { toast, useUi } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/Layout";
import { Field, PageSpinner, TypeToConfirm } from "@/components/common";

export default function Settings() {
  const wid = useCurrentWorkspaceId()!;
  const { data: ws, isLoading } = useWorkspace(wid);
  const me = useMe().data?.user;
  const { update } = useWorkspaceMutations(wid);
  const [f, setF] = useState({ name: "", defaultRole: "developer", domains: "", timezone: "" });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setWorkspace = useUi((s) => s.setWorkspace);
  useEffect(() => {
    if (ws) setF({ name: ws.name, defaultRole: ws.settings.defaultRole ?? "developer", domains: (ws.settings.allowedEmailDomains ?? []).join(", "), timezone: ws.settings.timezone ?? "" });
  }, [ws]);
  if (isLoading || !ws) return <PageSpinner />;
  if (!ws.permissions.includes("workspace:update")) return <Navigate to="/dashboard" replace />;

  const save = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ name: f.name, settings: {
      defaultRole: f.defaultRole as "developer" | "viewer",
      allowedEmailDomains: f.domains.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
      timezone: f.timezone || undefined,
    } });
  };
  const remove = async () => {
    try { await api(`/workspaces/${wid}`, { method: "DELETE" }); setWorkspace(null); await qc.invalidateQueries({ queryKey: ["me"] }); navigate("/dashboard"); }
    catch (e) { toast.error("Couldn't delete workspace", errorMessage(e)); }
  };

  return (
    <div>
      <PageHeader title="Workspace settings" />
      <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
        <Card>
          <form onSubmit={save} className="contents">
            <CardHeader><CardTitle>General</CardTitle><CardDescription>Applies to everyone in {ws.name}.</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Workspace name" htmlFor="ws-name"><Input id="ws-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Default role for new invites">
                <Select value={f.defaultRole} onValueChange={(defaultRole) => setF({ ...f, defaultRole })}>
                  <SelectTrigger className="w-full" aria-label="Default role for new invites"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="developer">Developer</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Allowed email domains" htmlFor="ws-domains" hint="Comma-separated, e.g. acme.com, acme.io. Leave empty to allow any address.">
                <Input id="ws-domains" value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} />
              </Field>
              <Field label="Timezone" htmlFor="ws-tz"><Input id="ws-tz" placeholder="e.g. Asia/Kolkata" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
            </CardContent>
            <CardFooter className="justify-end border-t"><Button type="submit" disabled={update.isPending}>{update.isPending && <Spinner />}Save changes</Button></CardFooter>
          </form>
        </Card>
        {ws.ownerId === me?.id && (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive">Danger zone</CardTitle>
              <CardDescription>Deleting the workspace removes every project, task, comment and file. This cannot be undone.</CardDescription>
            </CardHeader>
            <CardContent>
              <TypeToConfirm trigger={<Button variant="destructive">Delete workspace</Button>} title={`Delete ${ws.name}?`} phrase={ws.name} confirmLabel="Delete workspace"
                description="This permanently deletes the workspace and all of its projects." onConfirm={remove} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
