import { CalendarDays, CheckSquare, MessageSquare, Paperclip } from "lucide-react";
import { dueLabel } from "@/lib/format";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AvatarStack, LabelChip, PriorityIcon } from "./common";

export function TaskCard({ task, onOpen, dragging, compact }: { task: Task; onOpen: () => void; dragging?: boolean; compact?: boolean }) {
  const due = dueLabel(task.dueDate, task.status === "done");
  return (
    <div
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      data-slot="card"
      className={cn(
        "group bg-card text-card-foreground rounded-lg border p-3 text-left shadow-xs transition outline-none hover:border-foreground/20 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50",
        dragging && "opacity-40",
      )}
    >
      {!compact && task.labels.length > 0 && <div className="mb-2 flex flex-wrap gap-1">{task.labels.map((l) => <LabelChip key={l.id} label={l} />)}</div>}
      <p className={cn("text-sm leading-snug font-medium", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</p>
      <div className="text-muted-foreground mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
        <span className="shrink-0 font-mono text-[11px] whitespace-nowrap">{task.key}</span>
        <PriorityIcon priority={task.priority} />
        {task.storyPoints !== null && <Badge variant="secondary" className="h-5 px-1.5" title="Story points">{task.storyPoints}</Badge>}
        {due && (
          <span className={cn("inline-flex items-center gap-0.5", due.tone === "danger" && "text-destructive font-medium", due.tone === "warn" && "text-orange-600 dark:text-orange-400")}>
            <CalendarDays className="size-3" />{due.text}
          </span>
        )}
        <span className="flex-1" />
        {task.subtaskCount > 0 && <span className="inline-flex items-center gap-0.5" title="Subtasks"><CheckSquare className="size-3" />{task.subtaskDoneCount}/{task.subtaskCount}</span>}
        {task.commentCount > 0 && <span className="inline-flex items-center gap-0.5" title="Comments"><MessageSquare className="size-3" />{task.commentCount}</span>}
        {task.attachmentCount > 0 && <span className="inline-flex items-center gap-0.5" title="Attachments"><Paperclip className="size-3" />{task.attachmentCount}</span>}
        <AvatarStack users={task.assignees} size={20} max={2} />
      </div>
    </div>
  );
}
