import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { BarChart3, CalendarRange, CheckCircle2, GripVertical, Inbox, Pencil, Play, Plus, Target, Trash2 } from "lucide-react";
import { useBurndown, useProject, useSprintMutations, useSprints, useTaskList, useVelocity } from "@/hooks/queries";
import { useProjectRealtime } from "@/hooks/useRealtime";
import { fmtDate, toDateInput } from "@/lib/format";
import { STATUS_LABEL, type ProjectDetail, type Sprint, type Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BurndownChart, VelocityChart } from "@/components/Charts";
import { CreateTaskModal } from "@/components/CreateTaskModal";
import { PageHeader } from "@/components/Layout";
import { TaskDrawer } from "@/components/TaskDrawer";
import { AvatarStack, DatePicker, EmptyState, ErrorState, Field, InfiniteSentinel, PageSpinner, PriorityIcon, STATUS_STYLE, confirmAction } from "@/components/common";
import { dndBackend, dndOptions } from "./Board";

const PLAN = "PLAN";
type PlanItem = { task: Task; fromSprintId: string | null };

export default function SprintsPage() {
  const { pid = "" } = useParams();
  const project = useProject(pid);
  if (project.isLoading) return <PageSpinner />;
  if (project.error || !project.data) return <div className="p-6"><ErrorState error={project.error} retry={project.refetch} /></div>;
  return <DndProvider backend={dndBackend} options={dndOptions}><Sprints project={project.data} /></DndProvider>;
}

type Modal = null | { kind: "create" } | { kind: "edit" | "start" | "complete"; sprint: Sprint } | { kind: "task" };

function Sprints({ project }: { project: ProjectDetail }) {
  const [tab, setTab] = useState("planning");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const { data: sprints, isLoading } = useSprints(project.id);
  useProjectRealtime(project.id);
  const m = useSprintMutations(project.id);
  const canManage = project.permissions.includes("sprint:manage");
  const [modal, setModal] = useState<Modal>(null);
  const close = () => setModal(null);

  const active = sprints?.find((s) => s.status === "active");
  const planned = sprints?.filter((s) => s.status === "planned") ?? [];
  const completed = sprints?.filter((s) => s.status === "completed") ?? [];

  const onDropToSprint = (item: PlanItem, sprintId: string) => item.fromSprintId !== sprintId && m.addTasks.mutate({ id: sprintId, taskIds: [item.task.id] });
  const onDropToBacklog = (item: PlanItem) => item.fromSprintId && m.removeTask.mutate({ id: item.fromSprintId, taskId: item.task.id });

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-0">
      <PageHeader title={`${project.name} · Sprints`} subtitle="Plan sprints by dragging tasks from the backlog, then track progress in Reports."
        actions={<>
          <Button variant="outline" asChild><Link to={`/projects/${project.id}/board`}>Board</Link></Button>
          {project.permissions.includes("task:create") && <Button variant="outline" onClick={() => setModal({ kind: "task" })}><Plus />Task</Button>}
          {canManage && <Button onClick={() => setModal({ kind: "create" })}><Plus />New sprint</Button>}
        </>}>
        <TabsList className="mt-4">
          <TabsTrigger value="planning" className="px-4">Planning</TabsTrigger>
          <TabsTrigger value="reports" className="px-4">Reports</TabsTrigger>
        </TabsList>
      </PageHeader>

      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
        {isLoading ? <PageSpinner /> : <>
          <TabsContent value="reports"><Reports project={project} sprints={sprints ?? []} /></TabsContent>
          <TabsContent value="planning" className="space-y-5">
            {active && <SprintBox sprint={active} project={project} canManage={canManage} onDrop={onDropToSprint} onOpen={setOpenTask}
              actions={canManage && <Button size="sm" onClick={() => setModal({ kind: "complete", sprint: active })}><CheckCircle2 />Complete sprint</Button>} />}
            {planned.map((s) => (
              <SprintBox key={s.id} sprint={s} project={project} canManage={canManage} onDrop={onDropToSprint} onOpen={setOpenTask}
                actions={canManage && <>
                  <Button size="icon-sm" variant="ghost" onClick={() => setModal({ kind: "edit", sprint: s })} aria-label="Edit sprint"><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" className="hover:text-destructive" aria-label="Delete sprint"
                    onClick={async () => (await confirmAction({ title: `Delete ${s.name}?`, description: "Its tasks go back to the backlog.", confirmLabel: "Delete sprint", destructive: true })) && m.remove.mutate(s.id)}><Trash2 /></Button>
                  {active ? (
                    <Tooltip>
                      <TooltipTrigger asChild><span tabIndex={0}><Button size="sm" variant="secondary" disabled><Play />Start</Button></span></TooltipTrigger>
                      <TooltipContent>Complete the active sprint first</TooltipContent>
                    </Tooltip>
                  ) : <Button size="sm" onClick={() => setModal({ kind: "start", sprint: s })}><Play />Start</Button>}
                </>} />
            ))}
            {!active && !planned.length && <EmptyState icon={<CalendarRange />} title="No upcoming sprints" body="Create a sprint, drag backlog tasks into it, then start it."
              action={canManage && <Button onClick={() => setModal({ kind: "create" })}><Plus />New sprint</Button>} />}

            <Backlog project={project} sprints={[active, ...planned].filter(Boolean) as Sprint[]} canManage={canManage} onDrop={onDropToBacklog} onOpen={setOpenTask}
              onAssign={(task, sprintId) => m.addTasks.mutate({ id: sprintId, taskIds: [task.id] })} />

            {completed.length > 0 && (
              <Card className="gap-0 py-0">
                <CardHeader className="border-b py-3 [.border-b]:pb-3"><CardTitle className="text-sm">Completed sprints</CardTitle></CardHeader>
                <ul className="divide-y">
                  {completed.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-sm">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground">{fmtDate(s.startDate, "d MMM")} – {fmtDate(s.completedAt, "d MMM yyyy")}</span>
                      <span className="text-muted-foreground ml-auto"><b className="text-foreground">{s.completedPoints ?? 0}</b> / {s.committedPoints ?? 0} pts</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </TabsContent>
        </>}
      </div>

      <SprintFormDialog open={modal?.kind === "create"} title="New sprint" project={project} onClose={close} busy={m.create.isPending}
        onSubmit={async (v) => { await m.create.mutateAsync(v); close(); }} />
      {modal?.kind === "edit" && <SprintFormDialog open title={`Edit ${modal.sprint.name}`} project={project} sprint={modal.sprint} onClose={close} busy={m.update.isPending}
        onSubmit={async (v) => { await m.update.mutateAsync({ id: modal.sprint.id, ...v }); close(); }} />}
      {modal?.kind === "start" && <SprintFormDialog open title={`Start ${modal.sprint.name}`} cta="Start sprint" project={project} sprint={modal.sprint} requireDates onClose={close} busy={m.start.isPending}
        intro={<>{modal.sprint.stats.totalTasks} tasks · <b className="text-foreground">{modal.sprint.stats.totalPoints} points</b> will be committed. Team members will be notified.</>}
        onSubmit={async (v) => { await m.update.mutateAsync({ id: modal.sprint.id, name: v.name, goal: v.goal }); await m.start.mutateAsync({ id: modal.sprint.id, startDate: v.startDate ?? undefined, endDate: v.endDate ?? undefined }); close(); }} />}
      {modal?.kind === "complete" && <CompleteDialog sprint={modal.sprint} planned={planned} busy={m.complete.isPending} onClose={close}
        onSubmit={async (moveIncompleteTo) => { await m.complete.mutateAsync({ id: modal.sprint.id, moveIncompleteTo }); close(); setTab("reports"); }} />}
      {modal?.kind === "task" && <CreateTaskModal open project={project} sprints={sprints ?? []} onClose={close} />}
      {openTask && <TaskDrawer taskId={openTask} project={project} onClose={() => setOpenTask(null)} onOpen={setOpenTask} />}
    </Tabs>
  );
}

function SprintBox({ sprint, project, canManage, onDrop, onOpen, actions }: { sprint: Sprint; project: ProjectDetail; canManage: boolean; onDrop: (i: PlanItem, sid: string) => void; onOpen: (id: string) => void; actions?: React.ReactNode }) {
  const list = useTaskList(project.id, { sprintId: sprint.id, sort: "position" });
  const tasks = list.data?.pages.flatMap((p) => p.items) ?? [];
  const [{ over, can }, drop] = useDrop<PlanItem, void, { over: boolean; can: boolean }>({
    accept: PLAN, canDrop: (i) => canManage && i.fromSprintId !== sprint.id, drop: (i) => onDrop(i, sprint.id),
    collect: (m) => ({ over: m.isOver() && m.canDrop(), can: m.canDrop() }),
  }, [sprint.id, canManage]);
  const pct = sprint.stats.totalPoints ? (sprint.stats.donePoints / sprint.stats.totalPoints) * 100 : 0;

  return (
    <section ref={(el) => { drop(el); }} aria-label={sprint.name}
      className={cn("bg-card text-card-foreground rounded-xl border shadow-sm transition", over && "border-primary ring-primary/20 ring-4", can && !over && "border-primary/40")}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
        <h2 className="font-semibold">{sprint.name}</h2>
        {sprint.status === "active"
          ? <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Active</Badge>
          : <Badge variant="secondary">Planned</Badge>}
        <span className="text-muted-foreground text-xs">{sprint.startDate ? `${fmtDate(sprint.startDate, "d MMM")} – ${fmtDate(sprint.endDate, "d MMM")}` : "Dates not set"}</span>
        <span className="text-muted-foreground text-xs">{sprint.stats.totalTasks} tasks · {sprint.stats.totalPoints} pts</span>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
        {sprint.goal && <p className="text-muted-foreground flex w-full items-center gap-1.5 text-sm"><Target className="text-primary size-3.5 shrink-0" />{sprint.goal}</p>}
        {sprint.status === "active" && (
          <div className="flex w-full items-center gap-3">
            <Progress value={pct} className="h-1.5 bg-emerald-500/15" indicatorClassName="bg-emerald-500" aria-label="Sprint progress" />
            <span className="text-muted-foreground shrink-0 text-xs">{sprint.stats.donePoints}/{sprint.stats.totalPoints} pts done</span>
          </div>
        )}
      </header>
      <TaskRows tasks={tasks} sprintId={sprint.id} canDrag={canManage} onOpen={onOpen} empty="Drag tasks from the backlog to plan this sprint." />
      <InfiniteSentinel active={!!list.hasNextPage} loading={list.isFetchingNextPage} onVisible={() => list.fetchNextPage()} />
    </section>
  );
}

function Backlog({ project, sprints, canManage, onDrop, onOpen, onAssign }: { project: ProjectDetail; sprints: Sprint[]; canManage: boolean; onDrop: (i: PlanItem) => void; onOpen: (id: string) => void; onAssign: (t: Task, sid: string) => void }) {
  const list = useTaskList(project.id, { sprintId: "backlog", sort: "position", status: "backlog,in_progress,review" });
  const tasks = list.data?.pages.flatMap((p) => p.items) ?? [];
  const [{ over }, drop] = useDrop<PlanItem, void, { over: boolean }>({
    accept: PLAN, canDrop: (i) => canManage && !!i.fromSprintId, drop: onDrop,
    collect: (m) => ({ over: m.isOver() && m.canDrop() }),
  }, [canManage]);
  return (
    <section ref={(el) => { drop(el); }} aria-label="Backlog" className={cn("bg-card text-card-foreground rounded-xl border shadow-sm", over && "border-primary ring-primary/20 ring-4")}>
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Inbox className="text-muted-foreground size-4" /><h2 className="font-semibold">Backlog</h2>
        <span className="text-muted-foreground text-xs">Open tasks not in a sprint</span>
      </header>
      {list.isLoading ? <div className="flex justify-center p-6"><Spinner /></div>
        : <TaskRows tasks={tasks} sprintId={null} canDrag={canManage} onOpen={onOpen} sprints={sprints} onAssign={onAssign} empty="The backlog is empty." />}
      <InfiniteSentinel active={!!list.hasNextPage} loading={list.isFetchingNextPage} onVisible={() => list.fetchNextPage()} />
    </section>
  );
}

function TaskRows({ tasks, sprintId, canDrag, onOpen, empty, sprints, onAssign }: { tasks: Task[]; sprintId: string | null; canDrag: boolean; onOpen: (id: string) => void; empty: string; sprints?: Sprint[]; onAssign?: (t: Task, sid: string) => void }) {
  if (!tasks.length) return <p className="text-muted-foreground px-4 py-6 text-center text-sm">{empty}</p>;
  return <ul className="divide-y">{tasks.map((t) => <TaskRow key={t.id} task={t} sprintId={sprintId} canDrag={canDrag} onOpen={onOpen} sprints={sprints} onAssign={onAssign} />)}</ul>;
}

function TaskRow({ task, sprintId, canDrag, onOpen, sprints, onAssign }: { task: Task; sprintId: string | null; canDrag: boolean; onOpen: (id: string) => void; sprints?: Sprint[]; onAssign?: (t: Task, sid: string) => void }) {
  const [{ dragging }, drag] = useDrag<PlanItem, void, { dragging: boolean }>({
    type: PLAN, item: { task, fromSprintId: sprintId }, canDrag, collect: (m) => ({ dragging: m.isDragging() }),
  }, [task, sprintId, canDrag]);
  return (
    <li ref={(el) => { drag(el); }} className={cn("hover:bg-accent/50 flex items-center gap-3 px-3 py-2.5", dragging && "opacity-40", canDrag && "cursor-grab")}>
      {canDrag && <GripVertical className="text-muted-foreground/50 size-4 shrink-0" />}
      <span className={cn("size-2 shrink-0 rounded-full", STATUS_STYLE[task.status].dot)} title={STATUS_LABEL[task.status]} />
      <span className="text-muted-foreground hidden w-16 shrink-0 font-mono text-xs sm:block">{task.key}</span>
      <button className="hover:text-primary min-w-0 flex-1 truncate text-left text-sm" onClick={() => onOpen(task.id)}>{task.title}</button>
      <PriorityIcon priority={task.priority} />
      <span className="text-muted-foreground w-8 shrink-0 text-right text-xs font-medium">{task.storyPoints ?? "–"}</span>
      <span className="hidden w-14 sm:block"><AvatarStack users={task.assignees} size={22} max={2} /></span>
      {onAssign && sprints && sprints.length > 0 && canDrag && (
        <Select value="" onValueChange={(v) => v && onAssign(task, v)}>
          <SelectTrigger size="sm" aria-label="Add to sprint" className="w-28 shrink-0 text-xs"><SelectValue placeholder="Add to…" /></SelectTrigger>
          <SelectContent align="end">{sprints.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
      )}
    </li>
  );
}

type SprintForm = { name?: string; goal?: string; startDate: string | null; endDate: string | null };
function SprintFormDialog({ open, title, cta = "Save", project, sprint, onSubmit, onClose, busy, requireDates, intro }: {
  open: boolean; title: string; cta?: string; project: ProjectDetail; sprint?: Sprint; onSubmit: (v: SprintForm) => Promise<void>; onClose: () => void; busy: boolean; requireDates?: boolean; intro?: React.ReactNode;
}) {
  const len = project.settings.defaultSprintLengthDays ?? 14;
  const today = new Date();
  const initial = () => ({
    name: sprint?.name ?? "", goal: sprint?.goal ?? "",
    start: toDateInput(sprint?.startDate ?? (requireDates ? today.toISOString() : null)),
    end: toDateInput(sprint?.endDate ?? (requireDates ? new Date(today.getTime() + len * 86400_000).toISOString() : null)),
  });
  const [f, setF] = useState(initial);
  const invalid = (requireDates && (!f.start || !f.end)) || (f.start && f.end && f.end <= f.start);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setF(initial()); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{intro ?? "Sprints time-box work; tasks are added from the backlog."}</DialogDescription>
        </DialogHeader>
        <form id="sprint-form" className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault();
          await onSubmit({
            name: f.name.trim() || undefined, goal: f.goal.trim() || undefined,
            startDate: f.start ? new Date(`${f.start}T00:00:00`).toISOString() : null, endDate: f.end ? new Date(`${f.end}T23:59:00`).toISOString() : null,
          });
          setF(initial());
        }}>
          <Field label="Name" htmlFor="sp-name" hint={sprint ? undefined : "Leave blank for the next number, e.g. “WEB Sprint 5”"}>
            <Input id="sp-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Sprint goal" htmlFor="sp-goal"><Textarea id="sp-goal" className="min-h-20" value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="What should this sprint achieve?" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><DatePicker value={f.start} clearable={!requireDates} onChange={(start) => setF({ ...f, start })} placeholder="Not set" /></Field>
            <Field label="End"><DatePicker value={f.end} clearable={!requireDates} onChange={(end) => setF({ ...f, end })} placeholder="Not set" /></Field>
          </div>
          {f.start && f.end && f.end <= f.start && <p className="text-destructive text-sm">End date must be after the start date.</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="sprint-form" disabled={!!invalid || busy}>{busy && <Spinner />}{cta}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ sprint, planned, busy, onClose, onSubmit }: { sprint: Sprint; planned: Sprint[]; busy: boolean; onClose: () => void; onSubmit: (to: string) => void }) {
  const [to, setTo] = useState(planned[0]?.id ?? "backlog");
  const open = sprint.stats.totalTasks - sprint.stats.doneTasks;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete {sprint.name}</DialogTitle>
          <DialogDescription>Velocity is recorded from the points finished in this sprint.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
            <p className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">{sprint.stats.donePoints}</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400">of {sprint.committedPoints ?? sprint.stats.totalPoints} committed points done</p>
          </div>
          <div className="bg-muted rounded-lg border p-3">
            <p className="text-2xl font-semibold">{open}</p>
            <p className="text-muted-foreground text-xs">unfinished task{open === 1 ? "" : "s"}</p>
          </div>
        </div>
        {open > 0 && (
          <Field label="Move unfinished tasks to">
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger className="w-full" aria-label="Move unfinished tasks to"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="backlog">Backlog</SelectItem>
                {planned.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => onSubmit(to)}>{busy && <Spinner />}Complete sprint</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Reports({ project, sprints }: { project: ProjectDetail; sprints: Sprint[] }) {
  const reportable = sprints.filter((s) => s.status !== "planned");
  const [sid, setSid] = useState(reportable[0]?.id);
  const burndown = useBurndown(sid);
  const velocity = useVelocity(project.id);
  const selected = reportable.find((s) => s.id === sid);
  if (!reportable.length) return <EmptyState icon={<BarChart3 />} title="No sprint data yet" body="Start a sprint to see its burndown; complete sprints to build velocity." />;
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <CardTitle>Burndown</CardTitle>
          <Select value={sid} onValueChange={setSid}>
            <SelectTrigger className="ml-auto" aria-label="Sprint"><SelectValue /></SelectTrigger>
            <SelectContent align="end">{reportable.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.status === "active" ? " (active)" : ""}</SelectItem>)}</SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {selected && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Committed" value={selected.committedPoints ?? 0} />
              <Stat label="Completed" value={selected.status === "completed" ? selected.completedPoints ?? 0 : selected.stats.donePoints} />
              <Stat label="Tasks done" value={`${selected.stats.doneTasks}/${selected.stats.totalTasks}`} />
              <Stat label={selected.status === "active" ? "Ends" : "Ended"} value={fmtDate(selected.status === "active" ? selected.endDate : selected.completedAt, "d MMM")} />
            </div>
          )}
          {burndown.isLoading ? <PageSpinner /> : burndown.data && <BurndownChart data={burndown.data} />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Velocity</CardTitle></CardHeader>
        <CardContent>
          {velocity.isLoading ? <PageSpinner /> : velocity.data?.items.length ? <VelocityChart data={velocity.data} /> : <p className="text-muted-foreground py-10 text-center text-sm">Complete a sprint to start tracking velocity.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="bg-muted/60 rounded-lg border px-3 py-2.5"><p className="text-muted-foreground text-xs">{label}</p><p className="text-lg font-semibold tabular-nums">{value}</p></div>
);
