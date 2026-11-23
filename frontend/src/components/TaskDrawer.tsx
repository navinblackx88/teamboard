import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CheckCircle2, Circle, Copy, Flag, Hash, Layers, Plus, Tag, Timer, Trash2, User as UserIcon, Users } from "lucide-react";
import { useActivity, useCreateTask, useCurrentWorkspaceId, useDeleteTask, useSprints, useTask, useUpdateTask, type TaskPatch } from "@/hooks/queries";
import { fmtDate, fromDateInput, timeAgo, toDateInput } from "@/lib/format";
import { PRIORITIES, STATUSES, STATUS_LABEL, type Priority, type ProjectDetail, type TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Attachments } from "./Attachments";
import { CommentThread } from "./Comments";
import { Markdown } from "./Markdown";
import { InlineSelect, LabelPicker, UserMultiPicker } from "./Pickers";
import { DatePicker, ErrorState, PageSpinner, PRIORITY_META, STATUS_STYLE, UserAvatar, confirmAction } from "./common";

function IconAction({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} className={className}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TaskDrawer({ taskId, project, onClose, onOpen }: { taskId: string; project: ProjectDetail; onClose: () => void; onOpen: (id: string) => void }) {
  const { data: task, isLoading, error, refetch } = useTask(taskId);
  const { data: sprints = [] } = useSprints(project.id);
  const update = useUpdateTask(project.id);
  const del = useDeleteTask(project.id);
  const [tab, setTab] = useState("comments");

  const can = (p: (typeof project.permissions)[number]) => project.permissions.includes(p);
  const editable = can("task:update");
  const patch = (body: TaskPatch) => update.mutate({ id: taskId, ...body });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-label="Task details" className="w-full gap-0 p-0 sm:max-w-2xl [&>button:last-child]:top-3.5">
        <SheetHeader className="flex-row items-center gap-1 border-b py-2.5 pr-12">
          {task?.parent && (
            <>
              <Button variant="link" size="sm" className="text-muted-foreground h-auto px-0" onClick={() => onOpen(task.parent!.id)}>{task.parent.key}</Button>
              <span className="text-muted-foreground/50">/</span>
            </>
          )}
          <SheetTitle className="text-muted-foreground font-mono text-sm font-normal">{task?.key ?? "Task"}</SheetTitle>
          <SheetDescription className="sr-only">Task details, comments, files and history</SheetDescription>
          <IconAction label="Copy link" onClick={() => { navigator.clipboard?.writeText(window.location.href); toast.success("Link copied"); }}><Copy /></IconAction>
          <div className="flex-1" />
          {task && (can("task:delete") || editable) && (
            <IconAction label="Delete task" className="hover:text-destructive" onClick={async () => {
              const ok = await confirmAction({ title: `Delete ${task.key}?`, description: "This also deletes its subtasks, comments and files.", confirmLabel: "Delete task", destructive: true });
              if (!ok) return;
              await del.mutateAsync(task.id);
              onClose();
            }}><Trash2 /></IconAction>
          )}
        </SheetHeader>

        {isLoading ? <PageSpinner /> : error || !task ? <div className="p-6"><ErrorState error={error} retry={refetch} /></div> : (
          <div className="scroll-thin flex-1 overflow-y-auto">
            <div className="space-y-5 px-5 py-5">
              <EditableTitle value={task.title} disabled={!editable} onSave={(title) => patch({ title })} />

              <dl className="grid grid-cols-[7.5rem_1fr] items-center gap-x-3 gap-y-1 text-sm">
                <Prop icon={<Circle />} label="Status">
                  <InlineSelect label="Status" disabled={!editable} value={task.status} onChange={(status) => patch({ status: status as TaskStatus })}
                    options={STATUSES.map((s) => ({ value: s, label: <><span className={cn("size-2.5 rounded-full", STATUS_STYLE[s].dot)} />{STATUS_LABEL[s]}</> }))} />
                </Prop>
                <Prop icon={<Flag />} label="Priority">
                  <InlineSelect label="Priority" disabled={!editable} value={task.priority} onChange={(priority) => patch({ priority: priority as Priority })}
                    options={PRIORITIES.map((p) => ({ value: p, label: <span className={cn("flex items-center gap-1.5", PRIORITY_META[p].className)}>{PRIORITY_META[p].icon}<span className="text-foreground">{PRIORITY_META[p].label}</span></span> }))} />
                </Prop>
                <Prop icon={<Users />} label="Assignees">
                  <UserMultiPicker disabled={!editable} users={project.members} value={task.assignees.map((a) => a.id)} onChange={(assigneeIds) => patch({ assigneeIds })} />
                </Prop>
                <Prop icon={<Tag />} label="Labels">
                  <LabelPicker disabled={!editable} labels={project.labels} value={task.labels.map((l) => l.id)} onChange={(labelIds) => patch({ labelIds })} />
                </Prop>
                <Prop icon={<Hash />} label="Story points">
                  <Input type="number" min={0} max={100} disabled={!editable} defaultValue={task.storyPoints ?? ""} key={`sp-${task.storyPoints}`} aria-label="Story points"
                    onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== task.storyPoints) patch({ storyPoints: v }); }}
                    className="hover:bg-accent w-24 border-transparent shadow-none dark:bg-transparent" placeholder="—" />
                </Prop>
                <Prop icon={<CalendarDays />} label="Due date">
                  <DatePicker variant="ghost" disabled={!editable} value={toDateInput(task.dueDate)} placeholder="No due date"
                    onChange={(v) => patch({ dueDate: fromDateInput(v) })} className="max-w-56" />
                </Prop>
                {!task.parentId && (
                  <Prop icon={<Timer />} label="Sprint">
                    <InlineSelect label="Sprint" disabled={!can("sprint:manage") && !editable} value={task.sprintId ?? ""} onChange={(v) => patch({ sprintId: v || null })}
                      options={[{ value: "", label: "Backlog" }, ...sprints.filter((s) => s.status !== "completed" || s.id === task.sprintId).map((s) => ({ value: s.id, label: `${s.name}${s.status === "active" ? " (active)" : ""}` }))]} />
                  </Prop>
                )}
                <Prop icon={<UserIcon />} label="Reporter">
                  <span className="flex items-center gap-1.5 px-2 py-1.5">{task.reporter ? <><UserAvatar user={task.reporter} size={20} />{task.reporter.name}</> : "—"}</span>
                </Prop>
              </dl>

              <Description value={task.description} disabled={!editable} onSave={(description) => patch({ description })} />

              {!task.parentId && <Subtasks parentId={task.id} project={project} subtasks={task.subtasks} editable={editable} onOpen={onOpen} />}

              <p className="text-muted-foreground text-xs">
                Created {fmtDate(task.createdAt, "d MMM yyyy, HH:mm")} · Updated {timeAgo(task.updatedAt)}{task.completedAt && ` · Completed ${fmtDate(task.completedAt)}`}
              </p>
            </div>

            <Separator />
            <Tabs value={tab} onValueChange={setTab} className="px-5 pt-4 pb-8">
              <TabsList>
                <TabsTrigger value="comments">Comments{task.commentCount > 0 && <Badge variant="secondary" className="h-4 px-1.5">{task.commentCount}</Badge>}</TabsTrigger>
                <TabsTrigger value="files">Files{task.attachmentCount > 0 && <Badge variant="secondary" className="h-4 px-1.5">{task.attachmentCount}</Badge>}</TabsTrigger>
                <TabsTrigger value="activity">History</TabsTrigger>
              </TabsList>
              <TabsContent value="comments" className="pt-3">
                <CommentThread taskId={task.id} projectId={project.id} users={project.members} canComment={can("comment:create")} canModerate={can("comment:moderate")} />
              </TabsContent>
              <TabsContent value="files" className="pt-3">
                <Attachments taskId={task.id} projectId={project.id} canUpload={can("file:upload")} canModerate={can("file:moderate")} />
              </TabsContent>
              <TabsContent value="activity" className="pt-3"><TaskHistory taskId={task.id} /></TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const Prop = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
  <>
    <dt className="text-muted-foreground flex items-center gap-2 [&>svg]:size-4">{icon}{label}</dt>
    <dd className="min-w-0">{children}</dd>
  </>
);

function EditableTitle({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Textarea rows={1} disabled={disabled} value={v} onChange={(e) => setV(e.target.value)} aria-label="Task title"
      onBlur={() => { const t = v.trim(); if (t && t !== value) onSave(t); else setV(value); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
      className="hover:bg-accent/60 min-h-0 resize-none border-transparent px-1.5 py-1 text-xl! font-semibold tracking-tight shadow-none disabled:opacity-100 disabled:hover:bg-transparent dark:bg-transparent" />
  );
}

function Description({ value, onSave, disabled }: { value: string | null; onSave: (v: string | null) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-semibold">Description</h3>
      {editing ? (
        <div className="space-y-2">
          <Textarea autoFocus className="min-h-36 font-mono text-[13px]" value={v} onChange={(e) => setV(e.target.value)} placeholder="Markdown supported: **bold**, `code`, - lists, [links](https://…)" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setV(value ?? ""); setEditing(false); }}>Cancel</Button>
            <Button size="sm" onClick={() => { onSave(v.trim() || null); setEditing(false); }}>Save</Button>
          </div>
        </div>
      ) : (
        <div onClick={() => !disabled && setEditing(true)} className={cn("min-h-12 rounded-md px-2 py-1.5 text-sm", !disabled && "hover:bg-accent/60 cursor-text", !value && "text-muted-foreground")}>
          {value ? <Markdown text={value} /> : disabled ? "No description." : "Add a description…"}
        </div>
      )}
    </div>
  );
}

function Subtasks({ parentId, project, subtasks, editable, onOpen }: { parentId: string; project: ProjectDetail; subtasks: { id: string; key: string; title: string; status: TaskStatus; assignees: { id: string; name: string; avatarUrl: string | null }[] }[]; editable: boolean; onOpen: (id: string) => void }) {
  const create = useCreateTask(project.id);
  const update = useUpdateTask(project.id);
  const [title, setTitle] = useState("");
  const done = subtasks.filter((s) => s.status === "done").length;
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold"><Layers className="size-4" />Subtasks {subtasks.length > 0 && <span className="text-muted-foreground font-normal">{done}/{subtasks.length}</span>}</h3>
      <ul className="divide-y rounded-lg border">
        {subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2.5 px-3 py-2">
            <button disabled={!editable} aria-label={s.status === "done" ? "Mark not done" : "Mark done"} onClick={() => update.mutate({ id: s.id, status: s.status === "done" ? "in_progress" : "done" })}>
              {s.status === "done" ? <CheckCircle2 className="size-5 text-emerald-500" /> : <Circle className="text-muted-foreground/50 hover:text-muted-foreground size-5" />}
            </button>
            <button onClick={() => onOpen(s.id)} className={cn("hover:text-primary min-w-0 flex-1 truncate text-left text-sm", s.status === "done" && "text-muted-foreground line-through")}>{s.title}</button>
            <span className="text-muted-foreground font-mono text-[11px]">{s.key}</span>
            {s.assignees[0] && <UserAvatar user={s.assignees[0]} size={20} />}
          </li>
        ))}
        {editable && (
          <li className="px-3 py-1.5">
            <form className="flex items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; await create.mutateAsync({ title: title.trim(), parentId }); setTitle(""); }}>
              <Plus className="text-muted-foreground size-4" />
              <input className="placeholder:text-muted-foreground flex-1 bg-transparent py-1 text-sm outline-none" placeholder="Add a subtask and press Enter" value={title} onChange={(e) => setTitle(e.target.value)} />
            </form>
          </li>
        )}
      </ul>
    </div>
  );
}

function TaskHistory({ taskId }: { taskId: string }) {
  const wid = useCurrentWorkspaceId();
  const { data, isLoading } = useActivity(wid, { page: 1, pageSize: 50, taskId });
  if (isLoading) return <PageSpinner />;
  if (!data?.items.length) return <p className="text-muted-foreground py-4 text-center text-sm">No history yet.</p>;
  return (
    <ol className="space-y-3">
      {data.items.map((a) => (
        <li key={a.id} className="flex gap-2.5 text-sm">
          {a.actor ? <UserAvatar user={a.actor} size={22} /> : <span className="bg-muted size-[22px] rounded-full" />}
          <p className="text-muted-foreground min-w-0 flex-1"><span className="text-foreground font-medium">{a.actor?.name ?? "Someone"}</span> {a.summary} <span className="text-xs">· {timeAgo(a.createdAt)}</span></p>
        </li>
      ))}
      <li className="pt-1 text-center"><Button variant="link" size="sm" asChild><Link to={`/activity?taskId=${taskId}`}>Open in activity log</Link></Button></li>
    </ol>
  );
}
