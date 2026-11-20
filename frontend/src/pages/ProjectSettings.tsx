import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trash2, UserMinus } from "lucide-react";
import { useMembers, useProject, useProjectMutations } from "@/hooks/queries";
import { STATUSES, STATUS_LABEL, type ProjectDetail, type TaskStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/Layout";
import { UserMultiPicker } from "@/components/Pickers";
import { ErrorState, Field, LabelChip, PageSpinner, TypeToConfirm, UserAvatar, confirmAction } from "@/components/common";

const NONE = "__none__";

export default function ProjectSettingsPage() {
  const { pid = "" } = useParams();
  const project = useProject(pid);
  if (project.isLoading) return <PageSpinner />;
  if (project.error || !project.data) return <div className="p-6"><ErrorState error={project.error} retry={project.refetch} /></div>;
  return <ProjectSettings project={project.data} />;
}

function ProjectSettings({ project }: { project: ProjectDetail }) {
  const m = useProjectMutations(project.id, project.workspaceId);
  const { data: wsMembers = [] } = useMembers(project.workspaceId);
  const navigate = useNavigate();
  const can = (p: (typeof project.permissions)[number]) => project.permissions.includes(p);
  const editable = can("project:update");
  const [f, setF] = useState({ name: project.name, description: project.description ?? "", color: project.color, leadId: project.leadId ?? "", sprintLen: String(project.settings.defaultSprintLengthDays ?? 14), wip: {} as Partial<Record<TaskStatus, string>> });
  useEffect(() => setF((x) => ({ ...x, wip: Object.fromEntries(Object.entries(project.settings.wipLimits ?? {}).map(([k, v]) => [k, String(v)])) })), [project.settings.wipLimits]);
  const [adding, setAdding] = useState<string[]>([]);
  const [label, setLabel] = useState({ name: "", color: "#3b82f6" });

  const save = (e: FormEvent) => {
    e.preventDefault();
    const wipLimits = Object.fromEntries(Object.entries(f.wip).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => [k, Number(v)]));
    m.update.mutate({ name: f.name, description: f.description || null, color: f.color, leadId: f.leadId || null, settings: { defaultSprintLengthDays: Number(f.sprintLen), wipLimits } });
  };
  const nonMembers = wsMembers.filter((u) => !project.members.some((pm) => pm.id === u.id));

  return (
    <div>
      <PageHeader title={`${project.name} · Settings`} />
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <Card>
          <form onSubmit={save} className="contents">
            <CardHeader><CardTitle>General</CardTitle><CardDescription>Name, lead, sprint defaults and column WIP limits.</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <Field label="Name" htmlFor="ps-name"><Input id="ps-name" disabled={!editable} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
                <Field label="Colour" htmlFor="ps-color"><Input id="ps-color" type="color" disabled={!editable} className="w-16 cursor-pointer p-1" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></Field>
              </div>
              <Field label="Description" htmlFor="ps-desc"><Textarea id="ps-desc" className="min-h-20" disabled={!editable} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project lead">
                  <Select disabled={!editable} value={f.leadId || NONE} onValueChange={(v) => setF({ ...f, leadId: v === NONE ? "" : v })}>
                    <SelectTrigger className="w-full" aria-label="Project lead"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value={NONE}>None</SelectItem>{project.members.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Default sprint length (days)" htmlFor="ps-len"><Input id="ps-len" type="number" min={1} max={60} disabled={!editable} value={f.sprintLen} onChange={(e) => setF({ ...f, sprintLen: e.target.value })} /></Field>
              </div>
              <Field label="WIP limits per column">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {STATUSES.map((s) => (
                    <div key={s} className="grid gap-1.5">
                      <Label htmlFor={`wip-${s}`} className="text-muted-foreground text-xs font-normal">{STATUS_LABEL[s]}</Label>
                      <Input id={`wip-${s}`} type="number" min={0} placeholder="No limit" disabled={!editable} value={f.wip[s] ?? ""} onChange={(e) => setF({ ...f, wip: { ...f.wip, [s]: e.target.value } })} />
                    </div>
                  ))}
                </div>
              </Field>
            </CardContent>
            {editable && <CardFooter className="justify-end border-t"><Button type="submit" disabled={m.update.isPending}>{m.update.isPending && <Spinner />}Save changes</Button></CardFooter>}
          </form>
        </Card>

        <Card>
          <CardHeader><CardTitle>Members <span className="text-muted-foreground font-normal">{project.members.length}</span></CardTitle></CardHeader>
          <CardContent>
            {can("project:members") && nonMembers.length > 0 && (
              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <div className="flex-1"><UserMultiPicker bordered users={nonMembers} value={adding} onChange={setAdding} placeholder="Choose workspace members to add" /></div>
                <Button disabled={!adding.length || m.addMembers.isPending} onClick={async () => { await m.addMembers.mutateAsync(adding); setAdding([]); }}>{m.addMembers.isPending && <Spinner />}Add</Button>
              </div>
            )}
            <ul className="divide-y">
              {project.members.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-2.5">
                  <UserAvatar user={u} size={30} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{u.name}</span><span className="text-muted-foreground block truncate text-xs">{u.email}</span></span>
                  {project.leadId === u.id && <Badge variant="secondary">Lead</Badge>}
                  {can("project:members") && <Button variant="ghost" size="icon-sm" aria-label={`Remove ${u.name}`} className="hover:text-destructive" onClick={() => m.removeMember.mutate(u.id)}><UserMinus /></Button>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Labels</CardTitle><CardDescription>Used to tag and filter tasks on the board.</CardDescription></CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              {project.labels.map((l) => (
                <span key={l.id} className="inline-flex items-center gap-0.5"><LabelChip label={l} />
                  {can("label:manage") && (
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive size-6" aria-label={`Delete label ${l.name}`}
                      onClick={async () => (await confirmAction({ title: `Delete label "${l.name}"?`, description: "It's removed from every task that uses it.", confirmLabel: "Delete label", destructive: true })) && m.deleteLabel.mutate(l.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </span>
              ))}
            </div>
            {can("label:manage") && (
              <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); await m.createLabel.mutateAsync(label); setLabel({ ...label, name: "" }); }}>
                <Input type="color" className="w-12 cursor-pointer p-1" value={label.color} onChange={(e) => setLabel({ ...label, color: e.target.value })} aria-label="Label colour" />
                <Input className="flex-1" required maxLength={40} placeholder="New label" value={label.name} onChange={(e) => setLabel({ ...label, name: e.target.value })} aria-label="Label name" />
                <Button type="submit" variant="outline" disabled={m.createLabel.isPending}>{m.createLabel.isPending && <Spinner />}Add label</Button>
              </form>
            )}
          </CardContent>
        </Card>

        {(can("project:update") || can("project:delete")) && (
          <Card className="border-destructive/40">
            <CardHeader><CardTitle className="text-destructive">Danger zone</CardTitle><CardDescription>Archiving hides the project from the sidebar; deleting is permanent.</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {can("project:update") && <Button variant="outline" onClick={() => m.update.mutate({ status: project.status === "active" ? "archived" : "active" })}>{project.status === "active" ? "Archive project" : "Restore project"}</Button>}
              {can("project:delete") && (
                <TypeToConfirm trigger={<Button variant="destructive">Delete project</Button>} title={`Delete ${project.name}?`} phrase={project.key} confirmLabel="Delete project"
                  description="All of its tasks, sprints, comments and files are deleted. This cannot be undone."
                  onConfirm={async () => { await m.remove.mutateAsync(); navigate("/projects"); }} />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
