import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TouchBackend } from "react-dnd-touch-backend";
import { Plus, Search, Timer } from "lucide-react";
import { useBoard, useMembers, useMoveTask, useProject, useSprints, type BoardFilters } from "@/hooks/queries";
import { useProjectRealtime } from "@/hooks/useRealtime";
import { fmtDate } from "@/lib/format";
import { PRIORITIES, STATUSES, STATUS_LABEL, type ProjectDetail, type Task, type TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CreateTaskModal } from "@/components/CreateTaskModal";
import { PageHeader } from "@/components/Layout";
import { TaskCard } from "@/components/TaskCard";
import { TaskDrawer } from "@/components/TaskDrawer";
import { AvatarStack, ErrorState, PageSpinner, PRIORITY_META, STATUS_STYLE } from "@/components/common";

/** Radix Select can't use "" as a value: "any" stands for "no filter". */
const ANY = "__any__";
function FilterSelect({ label, value, onChange, options, anyLabel }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; options: { value: string; label: React.ReactNode }[]; anyLabel?: string }) {
  return (
    <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : v)}>
      <SelectTrigger aria-label={label} className="bg-background shrink-0"><SelectValue /></SelectTrigger>
      <SelectContent>
        {anyLabel && <SelectItem value={ANY}>{anyLabel}</SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const CARD = "CARD";
type DragItem = { task: Task };
type Hover = { status: TaskStatus; index: number } | null;

export const isTouch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
export const dndBackend = isTouch ? TouchBackend : HTML5Backend;
export const dndOptions = isTouch ? { enableMouseEvents: true, delayTouchStart: 180, ignoreContextMenu: true } : undefined;

export default function BoardPage() {
  const { pid = "" } = useParams();
  const project = useProject(pid);
  if (project.isLoading) return <PageSpinner />;
  if (project.error || !project.data) return <div className="p-6"><ErrorState error={project.error} retry={project.refetch} /></div>;
  return (
    <DndProvider backend={dndBackend} options={dndOptions}>
      <Board project={project.data} />
    </DndProvider>
  );
}

function Board({ project }: { project: ProjectDetail }) {
  const [params, setParams] = useSearchParams();
  const openTask = params.get("task");
  const setOpenTask = (id: string | null) => setParams((p) => { if (id) p.set("task", id); else p.delete("task"); return p; }, { replace: !id });

  const [filters, setFilters] = useState<BoardFilters>({ sprintId: project.activeSprint ? "active" : "all" });
  const [search, setSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setFilters((f) => ({ ...f, q: search || undefined })), 250); return () => clearTimeout(t); }, [search]);

  const board = useBoard(project.id, filters);
  const { data: sprints = [] } = useSprints(project.id);
  const { data: members = [] } = useMembers(project.workspaceId);
  const viewers = useProjectRealtime(project.id);
  const move = useMoveTask(project.id);
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const canCreate = project.permissions.includes("task:create");
  const canMove = project.permissions.includes("task:update");

  const [hover, setHover] = useState<Hover>(null);
  const hoverRef = useRef<Hover>(null);
  const setHoverBoth = (h: Hover) => { hoverRef.current = h; setHover((prev) => (prev?.status === h?.status && prev?.index === h?.index ? prev : h)); };

  const onDrop = (item: DragItem, status: TaskStatus) => {
    const last = hoverRef.current;
    setHoverBoth(null);
    if (!board.data) return;
    const list = board.data.columns[status].filter((t) => t.id !== item.task.id);
    // Trust the hover index only if it belongs to the column that received the drop.
    const target = last?.status === status ? last : { status, index: list.length };
    const original = board.data.columns[item.task.status].findIndex((t) => t.id === item.task.id);
    if (target.status === item.task.status && target.index === original) return; // dropped where it was
    const limit = board.data.wipLimits[target.status];
    if (limit && target.status !== item.task.status && list.length >= limit) toast.info(`${STATUS_LABEL[target.status]} is over its WIP limit (${limit})`);
    move.mutate({ task: item.task, status: target.status, index: target.index, afterId: list[target.index - 1]?.id ?? null, beforeId: list[target.index]?.id ?? null });
  };

  const viewerUsers = useMemo(() => members.filter((m) => viewers.includes(m.id)), [members, viewers]);
  const activeSprint = sprints.find((s) => s.status === "active");
  const scopedSprint = filters.sprintId === "active" ? activeSprint : sprints.find((s) => s.id === filters.sprintId);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={<span className="flex items-center gap-2"><span className="size-3 rounded" style={{ backgroundColor: project.color }} />{project.name}</span>}
        subtitle={scopedSprint
          ? <span className="inline-flex items-center gap-1.5"><Timer className="size-3.5" />{scopedSprint.name} · {fmtDate(scopedSprint.startDate, "d MMM")} – {fmtDate(scopedSprint.endDate, "d MMM")}{scopedSprint.goal && ` · ${scopedSprint.goal}`}</span>
          : "All open work"}
        actions={<>
          {viewerUsers.length > 1 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground flex items-center gap-2 text-xs"><AvatarStack users={viewerUsers} max={4} size={26} /><span className="hidden sm:inline">viewing</span></span>
              </TooltipTrigger>
              <TooltipContent>Viewing this project now: {viewerUsers.map((u) => u.name).join(", ")}</TooltipContent>
            </Tooltip>
          )}
          <Button variant="outline" asChild><Link to={`/projects/${project.id}/sprints`}><Timer />Sprints</Link></Button>
          {canCreate && <Button onClick={() => setCreating("backlog")}><Plus />New task</Button>}
        </>}
      >
        <div className="scroll-thin -mx-4 mt-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          <div className="relative w-44 shrink-0 sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
            <Input className="pl-8" placeholder="Filter cards" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Filter cards" />
          </div>
          <FilterSelect label="Sprint" value={filters.sprintId} onChange={(v) => setFilters({ ...filters, sprintId: v ?? "all" })} options={[
            { value: "all", label: "All open work" },
            ...(activeSprint ? [{ value: "active", label: `Active sprint: ${activeSprint.name}` }] : []),
            ...sprints.filter((s) => s.status === "planned").map((s) => ({ value: s.id, label: `${s.name} (planned)` })),
          ]} />
          <FilterSelect label="Assignee" anyLabel="Anyone" value={filters.assigneeId} onChange={(assigneeId) => setFilters({ ...filters, assigneeId })}
            options={project.members.map((m) => ({ value: m.id, label: m.name }))} />
          <FilterSelect label="Label" anyLabel="Any label" value={filters.labelId} onChange={(labelId) => setFilters({ ...filters, labelId })}
            options={project.labels.map((l) => ({ value: l.id, label: <><span className="size-2.5 rounded-full" style={{ backgroundColor: l.color }} />{l.name}</> }))} />
          <FilterSelect label="Priority" anyLabel="Any priority" value={filters.priority} onChange={(priority) => setFilters({ ...filters, priority })}
            options={PRIORITIES.map((p) => ({ value: p, label: <span className={cn("flex items-center gap-1.5", PRIORITY_META[p].className)}>{PRIORITY_META[p].icon}<span className="text-foreground">{PRIORITY_META[p].label}</span></span> }))} />
        </div>
      </PageHeader>

      {board.isLoading ? <BoardSkeleton /> : board.error ? <div className="p-6"><ErrorState error={board.error} retry={board.refetch} /></div> : board.data && (
        <div className="scroll-thin flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto p-3 sm:gap-4 sm:p-5">
          {STATUSES.map((status) => (
            <Column key={status} status={status} tasks={board.data!.columns[status]} limit={board.data!.wipLimits[status]}
              hover={hover} setHover={setHoverBoth} onDrop={onDrop} canMove={canMove}
              onOpen={setOpenTask} onAdd={canCreate ? () => setCreating(status) : undefined} />
          ))}
        </div>
      )}

      {creating && <CreateTaskModal open project={project} sprints={sprints} defaultStatus={creating}
        defaultSprintId={filters.sprintId === "active" ? activeSprint?.id ?? null : filters.sprintId !== "all" ? filters.sprintId : null}
        onClose={() => setCreating(null)} />}
      {openTask && <TaskDrawer taskId={openTask} project={project} onClose={() => setOpenTask(null)} onOpen={setOpenTask} />}
    </div>
  );
}

function Column({ status, tasks, limit, hover, setHover, onDrop, onOpen, onAdd, canMove }: {
  status: TaskStatus; tasks: Task[]; limit?: number; hover: Hover; setHover: (h: Hover) => void;
  onDrop: (i: DragItem, status: TaskStatus) => void; onOpen: (id: string) => void; onAdd?: () => void; canMove: boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [{ isOver }, drop] = useDrop<DragItem, void, { isOver: boolean }>({
    accept: CARD,
    hover: (item, monitor) => {
      // Over empty column space (not a card): append to the end.
      if (monitor.isOver({ shallow: true })) setHover({ status, index: tasks.filter((t) => t.id !== item.task.id).length });
    },
    drop: (item) => onDrop(item, status),
    collect: (m) => ({ isOver: m.isOver() }),
  }, [tasks, status, onDrop]);

  const visible = tasks.filter((t) => t.id !== dragId);
  const indicatorAt = hover?.status === status && isOver ? hover.index : -1;
  const over = limit !== undefined && limit > 0 && tasks.length > limit;
  const points = tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);

  return (
    <section ref={(el) => { drop(el); }} aria-label={STATUS_LABEL[status]}
      className={cn("bg-muted/60 flex w-[85vw] shrink-0 snap-start flex-col rounded-xl border border-transparent sm:w-72 xl:w-auto xl:min-w-64 xl:flex-1", isOver && "border-primary/40 ring-primary/15 ring-4")}>
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className={cn("size-2.5 rounded-full", STATUS_STYLE[status].dot)} />
        <h2 className="text-sm font-semibold">{STATUS_LABEL[status]}</h2>
        <Badge variant={over ? "destructive" : "outline"} className={cn("h-5 rounded-full px-1.5", !over && "bg-background text-muted-foreground")} title={limit ? `WIP limit ${limit}` : undefined}>
          {tasks.length}{limit ? `/${limit}` : ""}
        </Badge>
        <span className="text-muted-foreground ml-auto text-xs" title="Story points">{points} pts</span>
        {onAdd && <Button variant="ghost" size="icon-sm" className="text-muted-foreground size-6" onClick={onAdd} aria-label={`Add task to ${STATUS_LABEL[status]}`}><Plus /></Button>}
      </header>
      <div className="scroll-thin flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
        {tasks.map((t) => {
          const idxInVisible = visible.findIndex((v) => v.id === t.id);
          return (
            <div key={t.id}>
              {idxInVisible !== -1 && indicatorAt === idxInVisible && <DropLine />}
              <DraggableCard task={t} status={status} visible={visible} setHover={setHover} onOpen={() => onOpen(t.id)} canMove={canMove}
                onDragState={(d) => setDragId(d ? t.id : null)} />
            </div>
          );
        })}
        {indicatorAt === visible.length && <DropLine />}
        {!tasks.length && indicatorAt === -1 && <p className="text-muted-foreground py-6 text-center text-xs">Drop cards here</p>}
      </div>
    </section>
  );
}

const DropLine = () => <div className="bg-primary mb-2 h-1 rounded-full" />;

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-3 sm:p-5" aria-busy="true" aria-label="Loading board">
      {STATUSES.map((s) => (
        <div key={s} className="bg-muted/60 flex w-72 shrink-0 flex-col gap-2 rounded-xl p-2 xl:flex-1">
          <Skeleton className="m-1 h-5 w-28" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="bg-background h-24 rounded-lg" />)}
        </div>
      ))}
    </div>
  );
}

function DraggableCard({ task, status, visible, setHover, onOpen, canMove, onDragState }: {
  task: Task; status: TaskStatus; visible: Task[]; setHover: (h: Hover) => void; onOpen: () => void; canMove: boolean; onDragState: (d: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>({
    type: CARD, item: () => ({ task }), canDrag: canMove,
    collect: (m) => ({ isDragging: m.isDragging() }),
  }, [task, canMove]);
  useEffect(() => onDragState(isDragging), [isDragging]); // eslint-disable-line react-hooks/exhaustive-deps

  const [, drop] = useDrop<DragItem>({
    accept: CARD,
    hover: (item, monitor) => {
      if (!ref.current || item.task.id === task.id) return;
      const rect = ref.current.getBoundingClientRect();
      const y = monitor.getClientOffset()?.y ?? 0;
      const base = visible.filter((t) => t.id !== item.task.id).findIndex((t) => t.id === task.id);
      setHover({ status, index: y < rect.top + rect.height / 2 ? base : base + 1 });
    },
  }, [visible, task, status]);
  drag(drop(ref));

  return <div ref={ref} className={cn(canMove && "cursor-grab active:cursor-grabbing")}><TaskCard task={task} onOpen={onOpen} dragging={isDragging} /></div>;
}
