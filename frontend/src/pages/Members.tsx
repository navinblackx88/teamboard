import { useState, type FormEvent } from "react";
import { Copy, MailPlus, Trash2, UserMinus } from "lucide-react";
import { useCurrentWorkspaceId, useInvitations, useMe, useMembers, useWorkspace, useWorkspaceMutations } from "@/hooks/queries";
import { fmtDate } from "@/lib/format";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { toast } from "@/stores/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/Layout";
import { ErrorState, PageSpinner, UserAvatar, confirmAction } from "@/components/common";

const ROLES: Role[] = ["admin", "project_manager", "developer", "viewer"];
const ROLE_HELP: Record<Role, string> = {
  admin: "Full control, including members, roles and workspace settings",
  project_manager: "Manages projects, sprints, labels and project members",
  developer: "Creates and updates tasks, comments and uploads files",
  viewer: "Read-only access",
};

export default function Members() {
  const wid = useCurrentWorkspaceId()!;
  const { data: ws } = useWorkspace(wid);
  const myId = useMe().data?.user.id;
  const members = useMembers(wid);
  const canManage = !!ws?.permissions.includes("members:manage");
  const invites = useInvitations(wid, !!ws?.permissions.includes("invites:manage"));
  const m = useWorkspaceMutations(wid);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("developer");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const r = await m.invite.mutateAsync({ email, role });
    setEmail(""); setLastLink(r.inviteUrl ?? null);
    toast.success(`Invitation sent to ${r.email}`);
  };
  const copy = (s: string) => { navigator.clipboard?.writeText(s); toast.success("Invite link copied"); };

  return (
    <div>
      <PageHeader title="Members" subtitle={`${members.data?.length ?? 0} people in ${ws?.name ?? "this workspace"}`} />
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        {ws?.permissions.includes("invites:manage") && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MailPlus className="size-4" />Invite people</CardTitle>
              <CardDescription>{ROLE_HELP[role]}. Invitations expire after 7 days.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={invite} className="flex flex-col gap-2 sm:flex-row">
                <Input className="flex-1" type="email" required placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger className="sm:w-48" aria-label="Role"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.filter((r) => ws.role === "admin" || r !== "admin").map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="submit" disabled={m.invite.isPending}>{m.invite.isPending && <Spinner />}Send invite</Button>
              </form>
              {lastLink && (
                <div className="bg-muted mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs">
                  <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono">{lastLink}</span>
                  <Button size="sm" variant="outline" onClick={() => copy(lastLink)}><Copy />Copy link</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="gap-0 py-0">
          {members.isLoading ? <PageSpinner /> : members.error ? <div className="p-4"><ErrorState error={members.error} /></div> : (
            <Table>
              <TableHeader><TableRow><TableHead className="pl-4">Member</TableHead><TableHead className="w-48">Role</TableHead><TableHead className="w-12 pr-4"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {members.data!.map((u) => {
                  const isOwner = ws?.ownerId === u.id;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="pl-4">
                        <div className="flex items-center gap-3">
                          <UserAvatar user={u} size={36} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{u.name}{u.id === myId && <span className="text-muted-foreground font-normal"> (you)</span>}{isOwner && <Badge variant="outline" className="ml-2 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">Owner</Badge>}</p>
                            <p className="text-muted-foreground truncate text-xs">{u.email} · joined {fmtDate(u.joinedAt)}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canManage && !isOwner ? (
                          <Select value={u.role} onValueChange={(v) => m.setRole.mutate({ uid: u.id, role: v as Role })}>
                            <SelectTrigger size="sm" className="w-44" aria-label={`Role for ${u.name}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : <Badge variant="secondary">{ROLE_LABEL[u.role]}</Badge>}
                      </TableCell>
                      <TableCell className="pr-4">
                        {canManage && !isOwner && u.id !== myId && (
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${u.name}`} className="hover:text-destructive"
                            onClick={async () => (await confirmAction({ title: `Remove ${u.name}?`, description: "They lose access to every project in this workspace.", confirmLabel: "Remove", destructive: true })) && m.remove.mutate(u.id)}>
                            <UserMinus />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>

        {!!invites.data?.length && (
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-3 [.border-b]:pb-3"><CardTitle className="text-sm">Pending invitations</CardTitle></CardHeader>
            <ul className="divide-y">
              {invites.data.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{i.email}</span>
                  <Badge variant="secondary">{ROLE_LABEL[i.role]}</Badge>
                  <span className="text-muted-foreground hidden text-xs sm:inline">by {i.invitedBy.name} · expires {fmtDate(i.expiresAt, "d MMM")}</span>
                  <Button variant="ghost" size="icon-sm" aria-label="Revoke invitation" className="hover:text-destructive" onClick={() => m.revoke.mutate(i.id)}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-sm">What each role can do</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {ROLES.map((r) => <div key={r} className="bg-muted/60 rounded-md border px-3 py-2"><dt className="font-medium">{ROLE_LABEL[r]}</dt><dd className="text-muted-foreground text-xs">{ROLE_HELP[r]}</dd></div>)}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
