import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FolderKanban, Plus, Timer, Users } from "lucide-react";
import { useCan, useCreateProject, useCurrentWorkspaceId, useMembers, useProjects } from "@/hooks/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/Layout";
import { UserMultiPicker } from "@/components/Pickers";
import { EmptyState, ErrorState, Field, PageSpinner } from "@/components/common";

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6"];

export default function Projects() {
  const wid = useCurrentWorkspaceId();
  const { data, isLoading, error, refetch } = useProjects(wid);
  const canCreate = useCan("project:create");
  const [params, setParams] = useSearchParams();
  const creating = params.get("new") === "1" && canCreate;
  const [showArchived, setShowArchived] = useState(false);
  const list = data?.filter((p) => showArchived || p.status === "active") ?? [];

  return (
    <div>
      <PageHeader title="Projects" subtitle={`${data?.length ?? 0} project${data?.length === 1 ? "" : "s"} you can access`}
        actions={<>
          <div className="flex items-center gap-2">
            <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
            <Label htmlFor="show-archived" className="text-muted-foreground font-normal">Show archived</Label>
          </div>
          {canCreate && <Button onClick={() => setParams({ new: "1" })}><Plus />New project</Button>}
        </>} />
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        {isLoading ? <PageSpinner /> : error ? <ErrorState error={error} retry={refetch} /> : !list.length ? (
          <EmptyState icon={<FolderKanban />} title="No projects yet" body={canCreate ? "Create your first project to start planning work." : "Ask a project manager to add you to a project."}
            action={canCreate && <Button onClick={() => setParams({ new: "1" })}><Plus />New project</Button>} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((p) => {
              const pct = p.stats.total ? Math.round((p.stats.done / p.stats.total) * 100) : 0;
              return (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}/board`} className="block h-full rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    <Card className="hover:border-foreground/20 h-full gap-4 transition hover:shadow-md">
                      <CardHeader className="grid-cols-[auto_1fr] gap-x-3">
                        <span className="row-span-2 flex size-10 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: p.color }}>{p.key.slice(0, 2)}</span>
                        <CardTitle className="flex items-center gap-2 truncate">{p.name}{p.status === "archived" && <Badge variant="secondary">Archived</Badge>}</CardTitle>
                        <CardDescription className="font-mono text-xs">{p.key}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1">
                        {p.description && <p className="text-muted-foreground mb-4 line-clamp-2 text-sm">{p.description}</p>}
                        <div className="text-muted-foreground flex items-center justify-between text-xs"><span>{p.stats.done}/{p.stats.total} tasks done</span><span className="text-foreground font-semibold">{pct}%</span></div>
                        <Progress value={pct} className="mt-1.5 h-1.5" aria-label={`${p.name} progress`} />
                      </CardContent>
                      <CardFooter className="text-muted-foreground flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{p.memberCount}</span>
                        <span>{p.stats.inProgress} in progress · {p.stats.review} in review</span>
                        {p.activeSprint && <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400"><Timer />{p.activeSprint.name}</Badge>}
                      </CardFooter>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {wid && <CreateProjectDialog open={creating} wid={wid} onClose={() => setParams({})} />}
    </div>
  );
}

function CreateProjectDialog({ wid, open, onClose }: { wid: string; open: boolean; onClose: () => void }) {
  const create = useCreateProject(wid);
  const { data: members = [] } = useMembers(wid);
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", key: "", keyTouched: false, description: "", color: COLORS[0], memberIds: [] as string[] });
  const autoKey = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || name.slice(0, 3).toUpperCase();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = await create.mutateAsync({ name: f.name.trim(), key: f.key, description: f.description || undefined, color: f.color, memberIds: f.memberIds });
    onClose();
    navigate(`/projects/${p.id}/board`);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Projects hold a board, sprints and their own labels.</DialogDescription>
        </DialogHeader>
        <form id="new-project" onSubmit={submit} className="grid gap-4">
          <Field label="Name" htmlFor="np-name"><Input id="np-name" autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, key: f.keyTouched ? f.key : autoKey(e.target.value) })} /></Field>
          <Field label="Key" htmlFor="np-key" hint="Prefix for task IDs, e.g. WEB-12. 2–10 letters or digits.">
            <Input id="np-key" required className="font-mono uppercase" pattern="[A-Za-z][A-Za-z0-9]{1,9}" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase(), keyTouched: true })} />
          </Field>
          <Field label="Description" htmlFor="np-desc"><Textarea id="np-desc" className="min-h-20" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Colour">
            <div className="flex gap-2">{COLORS.map((c) => (
              <button type="button" key={c} aria-label={`Colour ${c}`} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })}
                className="ring-offset-background size-7 rounded-md ring-offset-2 aria-pressed:ring-2" style={{ backgroundColor: c, ["--tw-ring-color" as string]: c }} />
            ))}</div>
          </Field>
          <Field label="Members"><UserMultiPicker bordered users={members} value={f.memberIds} onChange={(memberIds) => setF({ ...f, memberIds })} placeholder="Just me (add more any time)" /></Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="new-project" disabled={create.isPending}>{create.isPending && <Spinner />}Create project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
