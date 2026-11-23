import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, History, X } from "lucide-react";
import { useActivity, useCurrentWorkspaceId, useMembers, useProjects, type ActivityFilters } from "@/hooks/queries";
import { fmtDate, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/Layout";
import { DatePicker, EmptyState, ErrorState, PageSpinner, UserAvatar } from "@/components/common";

const ALL = "__all__";
const TYPES = [
  { value: ALL, label: "All activity" },
  { value: "task.", label: "Tasks" },
  { value: "comment.", label: "Comments" },
  { value: "sprint.", label: "Sprints" },
  { value: "attachment.", label: "Files" },
  { value: "project.", label: "Projects" },
  { value: "member.", label: "Members" },
];

function UrlSelect({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: { value: string; label: React.ReactNode }[] }) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger aria-label={label} className="bg-background w-full sm:w-44"><SelectValue /></SelectTrigger>
      <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Paginated, filterable audit log. Filters live in the URL so views can be shared. */
export default function ActivityPage() {
  const wid = useCurrentWorkspaceId();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const set = (patch: Record<string, string>) => setParams((p) => {
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    if (!("page" in patch)) p.delete("page");
    return p;
  });

  const filters: ActivityFilters = {
    page: Number(get("page") || 1), pageSize: 25,
    projectId: get("projectId") || undefined, actorId: get("actorId") || undefined, action: get("action") || undefined, taskId: get("taskId") || undefined,
    from: get("from") ? new Date(`${get("from")}T00:00:00`).toISOString() : undefined,
    to: get("to") ? new Date(`${get("to")}T23:59:59`).toISOString() : undefined,
  };
  const { data, isLoading, error, refetch, isFetching } = useActivity(wid, filters);
  const { data: projects = [] } = useProjects(wid);
  const { data: members = [] } = useMembers(wid);
  const hasFilters = ["projectId", "actorId", "action", "from", "to", "taskId"].some((k) => params.get(k));

  return (
    <div>
      <PageHeader title="Activity" subtitle="A log of everything that changed in this workspace.">
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <UrlSelect label="Type" value={get("action")} onChange={(action) => set({ action })} items={TYPES} />
          <UrlSelect label="Project" value={get("projectId")} onChange={(projectId) => set({ projectId })}
            items={[{ value: ALL, label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: <><span className="size-2 rounded-sm" style={{ backgroundColor: p.color }} />{p.name}</> }))]} />
          <UrlSelect label="Person" value={get("actorId")} onChange={(actorId) => set({ actorId })}
            items={[{ value: ALL, label: "Everyone" }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
          <DatePicker className="sm:w-44" value={get("from")} onChange={(from) => set({ from })} placeholder="From" />
          <DatePicker className="sm:w-44" value={get("to")} onChange={(to) => set({ to })} placeholder="To" />
          {hasFilters && <Button variant="ghost" onClick={() => setParams({})}><X />Clear</Button>}
        </div>
      </PageHeader>

      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        {isLoading ? <PageSpinner /> : error || !data ? <ErrorState error={error} retry={refetch} /> : !data.items.length
          ? <EmptyState icon={<History />} title="No activity matches" body={hasFilters ? "Try widening the filters." : "Actions will be logged here."} />
          : (
            <Card className={cn("gap-0 py-0 transition-opacity", isFetching && "opacity-70")}>
              <ul className="divide-y">
                {data.items.map((a) => (
                  <li key={a.id} className="flex gap-3 px-4 py-3">
                    {a.actor ? <UserAvatar user={a.actor} size={30} /> : <span className="bg-muted size-[30px] shrink-0 rounded-full" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground text-sm"><b className="text-foreground font-medium">{a.actor?.name ?? "Someone"}</b> {a.summary}</p>
                      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span title={fmtDate(a.createdAt, "d MMM yyyy, HH:mm")}>{timeAgo(a.createdAt)}</span>
                        {a.project && <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm" style={{ backgroundColor: a.project.color }} />{a.project.name}</span>}
                        {a.taskId && a.taskTitle && a.project && <Link className="text-primary truncate hover:underline" to={`/projects/${a.project.id}/board?task=${a.taskId}`}>{a.taskTitle}</Link>}
                        <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px] font-normal">{a.action}</Badge>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <footer className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
                <span className="text-muted-foreground">{(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}</span>
                <nav aria-label="pagination" className="flex items-center gap-1">
                  <Button size="icon-sm" variant="ghost" disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) })} aria-label="Previous page"><ChevronLeft /></Button>
                  {pageList(data.page, data.totalPages).map((p, i) => p === "…" ? <span key={`e${i}`} className="text-muted-foreground px-1">…</span>
                    : <Button key={p} size="icon-sm" variant={p === data.page ? "outline" : "ghost"} aria-current={p === data.page ? "page" : undefined} onClick={() => set({ page: String(p) })}>{p}</Button>)}
                  <Button size="icon-sm" variant="ghost" disabled={data.page >= data.totalPages} onClick={() => set({ page: String(data.page + 1) })} aria-label="Next page"><ChevronRight /></Button>
                </nav>
              </footer>
            </Card>
          )}
      </div>
    </div>
  );
}

function pageList(cur: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, cur - 1, cur, cur + 1].filter((n) => n >= 1 && n <= total));
  const sorted = [...set].sort((a, b) => a - b);
  return sorted.flatMap((n, i) => (i && n - sorted[i - 1] > 1 ? ["…" as const, n] : [n]));
}
