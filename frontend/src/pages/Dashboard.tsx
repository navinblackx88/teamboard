import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, CheckCircle2, FolderKanban, ListTodo, Timer } from "lucide-react";
import { useActivity, useCurrentWorkspaceId, useDashboard, useMe } from "@/hooks/queries";
import { dueLabel, fmtDate, timeAgo } from "@/lib/format";
import { STATUSES, STATUS_LABEL, type Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/Layout";
import { AvatarStack, EmptyState, ErrorState, PriorityIcon, STATUS_STYLE, UserAvatar } from "@/components/common";

export default function Dashboard() {
  const wid = useCurrentWorkspaceId();
  const me = useMe().data?.user;
  const { data, isLoading, error, refetch } = useDashboard(wid);
  const activity = useActivity(wid, { page: 1, pageSize: 8 });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <PageHeader title={`${greeting}${me ? `, ${me.name.split(" ")[0]}` : ""}`} subtitle="Here's what's happening across your projects." />
      {isLoading ? <DashboardSkeleton /> : error || !data ? <div className="p-6"><ErrorState error={error} retry={refetch} /></div> : (
        <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={<ListTodo />} label="Open tasks assigned to me" value={data.myTasks.total - (data.myTasks.byStatus.done ?? 0)} to="/my-tasks" />
            <StatTile icon={<AlertTriangle />} label="Overdue" value={data.myTasks.overdue} tone={data.myTasks.overdue ? "danger" : undefined} to="/my-tasks" />
            <StatTile icon={<Timer />} label="Active sprints" value={data.activeSprints.length} />
            <StatTile icon={<FolderKanban />} label="Projects" value={data.projects.length} to="/projects" />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Section title="Assigned to me" to="/my-tasks" className="lg:col-span-2"
              footer={<div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
                {STATUSES.map((s) => <span key={s} className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", STATUS_STYLE[s].dot)} />{STATUS_LABEL[s]} <b className="text-foreground">{data.myTasks.byStatus[s] ?? 0}</b></span>)}
              </div>}>
              {data.myTasks.items.length ? <ul className="divide-y">{data.myTasks.items.map((t) => <TaskLine key={t.id} task={t} />)}</ul>
                : <div className="p-4"><EmptyState icon={<CheckCircle2 />} title="Nothing on your plate" body="Tasks assigned to you will show up here." /></div>}
            </Section>

            <Section title="Upcoming deadlines" description="Next two weeks">
              {data.upcomingDeadlines.length ? (
                <ul className="divide-y">
                  {data.upcomingDeadlines.map((t) => {
                    const due = dueLabel(t.dueDate);
                    return (
                      <li key={t.id}>
                        <Link to={`/projects/${t.projectId}/board?task=${t.id}`} className="hover:bg-accent/50 flex items-center gap-3 px-6 py-2.5">
                          <CalendarClock className={cn("size-4 shrink-0", t.overdue ? "text-destructive" : "text-muted-foreground")} />
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm">{t.title}</span><span className="text-muted-foreground font-mono text-[11px]">{t.key}</span></span>
                          <span className={cn("shrink-0 text-xs font-medium", due?.tone === "danger" ? "text-destructive" : due?.tone === "warn" ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground")}>{t.overdue ? `Overdue · ${due?.text}` : due?.text}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-muted-foreground px-6 py-8 text-center text-sm">No deadlines in the next two weeks.</p>}
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Section title="Sprint progress" className="lg:col-span-2">
              {data.activeSprints.length ? (
                <ul className="divide-y">
                  {data.activeSprints.map((s) => {
                    const pct = s.totalPoints ? (s.donePoints / s.totalPoints) * 100 : 0;
                    return (
                      <li key={s.id} className="px-6 py-3.5">
                        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="size-2.5 rounded-sm" style={{ backgroundColor: s.project.color }} />
                          <Link to={`/projects/${s.project.id}/sprints`} className="hover:text-primary font-medium">{s.name}</Link>
                          <span className="text-muted-foreground text-xs">{s.project.name}</span>
                          <span className={cn("ml-auto text-xs font-medium", (s.daysLeft ?? 99) <= 2 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground")}>
                            {s.daysLeft === null ? "" : s.daysLeft < 0 ? `${-s.daysLeft}d overdue` : s.daysLeft === 0 ? "Ends today" : `${s.daysLeft} days left`}
                          </span>
                        </div>
                        <Progress value={pct} className="h-1.5 bg-emerald-500/15" indicatorClassName="bg-emerald-500" aria-label={`${s.name} progress`} />
                        <div className="text-muted-foreground mt-1.5 flex justify-between text-xs">
                          <span>{s.donePoints}/{s.totalPoints} points · {s.doneTasks}/{s.totalTasks} tasks</span>
                          <span>{fmtDate(s.startDate, "d MMM")} – {fmtDate(s.endDate, "d MMM")}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-muted-foreground px-6 py-8 text-center text-sm">No sprints are running right now.</p>}
            </Section>

            <Section title="Recent activity" to="/activity">
              <ul className="space-y-3 px-6 py-1">
                {activity.data?.items.map((a) => (
                  <li key={a.id} className="flex gap-2.5 text-sm">
                    {a.actor ? <UserAvatar user={a.actor} size={24} /> : <span className="bg-muted size-6 shrink-0 rounded-full" />}
                    <p className="text-muted-foreground min-w-0"><b className="text-foreground font-medium">{a.actor?.name ?? "Someone"}</b> {a.summary}<span className="block text-xs">{timeAgo(a.createdAt)}</span></p>
                  </li>
                ))}
                {!activity.isLoading && !activity.data?.items.length && <p className="text-muted-foreground py-6 text-center text-sm">No activity yet.</p>}
              </ul>
            </Section>
          </div>

          <Section title="Projects" to="/projects">
            <ul className="bg-border grid gap-px border-y sm:grid-cols-2 xl:grid-cols-3">
              {data.projects.map((p) => (
                <li key={p.id} className="bg-card">
                  <Link to={`/projects/${p.id}/board`} className="hover:bg-accent/50 block px-6 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground font-mono text-xs">{p.key}</span>
                      <span className="ml-auto text-sm font-semibold tabular-nums">{p.progress}%</span>
                    </div>
                    <Progress value={p.progress} className="mt-2.5 h-1.5" aria-label={`${p.name} progress`} />
                    <p className="text-muted-foreground mt-1.5 text-xs">{p.done}/{p.total} done{p.overdue > 0 && <span className="text-destructive"> · {p.overdue} overdue</span>}{p.activeSprint && ` · ${p.activeSprint}`}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      <div className="grid gap-5 lg:grid-cols-3"><Skeleton className="h-72 rounded-xl lg:col-span-2" /><Skeleton className="h-72 rounded-xl" /></div>
    </div>
  );
}

function StatTile({ icon, label, value, tone, to }: { icon: React.ReactNode; label: string; value: number; tone?: "danger"; to?: string }) {
  const body = (
    <Card className={cn("h-full gap-2 py-4", to && "hover:border-foreground/20 transition")}>
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-2 text-xs font-medium [&>svg]:size-4">{icon}{label}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <p className={cn("text-3xl font-semibold tracking-tight tabular-nums", tone === "danger" && "text-destructive")}>{value}</p>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to} className="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">{body}</Link> : body;
}

function Section({ title, description, to, children, footer, className }: { title: string; description?: string; to?: string; children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-3 overflow-hidden pb-0", !footer && "pb-3", className)}>
      <CardHeader className="border-b [.border-b]:pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
        {to && <CardAction><Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild><Link to={to}>View all</Link></Button></CardAction>}
      </CardHeader>
      <CardContent className="px-0">{children}</CardContent>
      {footer && <CardFooter className="border-t py-3 [.border-t]:pt-3">{footer}</CardFooter>}
    </Card>
  );
}

export function TaskLine({ task }: { task: Task }) {
  const due = dueLabel(task.dueDate, task.status === "done");
  return (
    <li>
      <Link to={`/projects/${task.projectId}/board?task=${task.id}`} className="hover:bg-accent/50 flex items-center gap-3 px-6 py-2.5">
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_STYLE[task.status].dot)} title={STATUS_LABEL[task.status]} />
        <span className="text-muted-foreground w-16 shrink-0 font-mono text-xs">{task.key}</span>
        <span className={cn("min-w-0 flex-1 truncate text-sm", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</span>
        <PriorityIcon priority={task.priority} />
        {due && <span className={cn("hidden w-20 text-right text-xs sm:block", due.tone === "danger" ? "text-destructive font-medium" : due.tone === "warn" ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground")}>{due.text}</span>}
        <span className="hidden w-12 sm:block"><AvatarStack users={task.assignees} size={20} max={2} /></span>
      </Link>
    </li>
  );
}
