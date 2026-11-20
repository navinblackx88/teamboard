import { useState, type FormEvent } from "react";
import { useCreateTask } from "@/hooks/queries";
import { fromDateInput } from "@/lib/format";
import { PRIORITIES, STATUSES, STATUS_LABEL, type Priority, type ProjectDetail, type Sprint, type TaskStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { LabelPicker, UserMultiPicker } from "./Pickers";
import { DatePicker, Field, PRIORITY_META } from "./common";

const BACKLOG = "__backlog__";

export function CreateTaskModal({ project, open, onClose, defaultStatus = "backlog", defaultSprintId = null, sprints = [] }: {
  project: ProjectDetail; open: boolean; onClose: () => void; defaultStatus?: TaskStatus; defaultSprintId?: string | null; sprints?: Sprint[];
}) {
  const create = useCreateTask(project.id);
  const blank = { title: "", description: "", status: defaultStatus, priority: "medium" as Priority, storyPoints: "", dueDate: "", assigneeIds: [] as string[], labelIds: [] as string[], sprintId: defaultSprintId ?? "" };
  const [f, setF] = useState(blank);
  const [another, setAnother] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({
      title: f.title.trim(), description: f.description || null, status: f.status, priority: f.priority,
      storyPoints: f.storyPoints === "" ? null : Number(f.storyPoints), dueDate: fromDateInput(f.dueDate),
      assigneeIds: f.assigneeIds, labelIds: f.labelIds, sprintId: f.sprintId || null,
    });
    if (another) setF({ ...blank, status: f.status, sprintId: f.sprintId });
    else { setF(blank); onClose(); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New task in {project.name}</DialogTitle>
          <DialogDescription>Add it to the board; you can fill in details later.</DialogDescription>
        </DialogHeader>
        <form id="create-task" onSubmit={submit} className="grid gap-4">
          <Field label="Title" htmlFor="ct-title">
            <Input id="ct-title" autoFocus required maxLength={300} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What needs to be done?" />
          </Field>
          <Field label="Description" htmlFor="ct-desc">
            <Textarea id="ct-desc" className="min-h-24" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Add details, acceptance criteria…" />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Status">
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as TaskStatus })}>
                <SelectTrigger className="w-full" aria-label="Status"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v as Priority })}>
                <SelectTrigger className="w-full" aria-label="Priority"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_META[p].icon}{PRIORITY_META[p].label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Story points" htmlFor="ct-sp">
              <Input id="ct-sp" type="number" min={0} max={100} value={f.storyPoints} onChange={(e) => setF({ ...f, storyPoints: e.target.value })} />
            </Field>
            <Field label="Due date">
              <DatePicker value={f.dueDate} onChange={(dueDate) => setF({ ...f, dueDate })} placeholder="None" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Assignees"><UserMultiPicker bordered users={project.members} value={f.assigneeIds} onChange={(assigneeIds) => setF({ ...f, assigneeIds })} /></Field>
            <Field label="Labels"><LabelPicker bordered labels={project.labels} value={f.labelIds} onChange={(labelIds) => setF({ ...f, labelIds })} /></Field>
          </div>
          {sprints.length > 0 && (
            <Field label="Sprint">
              <Select value={f.sprintId || BACKLOG} onValueChange={(v) => setF({ ...f, sprintId: v === BACKLOG ? "" : v })}>
                <SelectTrigger className="w-full" aria-label="Sprint"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={BACKLOG}>Backlog (no sprint)</SelectItem>
                  {sprints.filter((s) => s.status !== "completed").map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.status === "active" ? " (active)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form>
        <DialogFooter className="items-center">
          <div className="mr-auto flex items-center gap-2">
            <Checkbox id="ct-another" checked={another} onCheckedChange={(c) => setAnother(c === true)} />
            <Label htmlFor="ct-another" className="text-muted-foreground font-normal">Create another</Label>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="create-task" disabled={!f.title.trim() || create.isPending}>{create.isPending && <Spinner />}Create task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
