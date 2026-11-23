import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useCurrentWorkspaceId, useMyTasks } from "@/hooks/queries";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/Layout";
import { EmptyState, ErrorState, InfiniteSentinel, PageSpinner } from "@/components/common";
import { TaskLine } from "./Dashboard";

const VIEWS = {
  open: { label: "Open", params: { status: "backlog,in_progress,review" } },
  in_progress: { label: "In progress", params: { status: "in_progress" } },
  review: { label: "In review", params: { status: "review" } },
  done: { label: "Done", params: { status: "done", sort: "updated" } },
} as const;

/** Every task assigned to me across the workspace, loaded page by page as you scroll. */
export default function MyTasks() {
  const wid = useCurrentWorkspaceId();
  const [view, setView] = useState<keyof typeof VIEWS>("open");
  const [sort, setSort] = useState("due");
  const q = useMyTasks(wid, { sort, ...VIEWS[view].params });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageHeader title="My tasks" subtitle="Everything assigned to you, across all projects."
        actions={view !== "done" && (
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="due">Due date</SelectItem><SelectItem value="updated">Recently updated</SelectItem><SelectItem value="created">Newest</SelectItem>
            </SelectContent>
          </Select>
        )}>
        <Tabs value={view} onValueChange={(v) => setView(v as keyof typeof VIEWS)} className="mt-4">
          <TabsList>{Object.entries(VIEWS).map(([value, v]) => <TabsTrigger key={value} value={value} className="px-3">{v.label}</TabsTrigger>)}</TabsList>
        </Tabs>
      </PageHeader>
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        {q.isLoading ? <PageSpinner /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : !items.length
          ? <EmptyState icon={<CheckCircle2 />} title="No tasks here" body="Tasks assigned to you will appear here." />
          : <Card className="gap-0 py-0">
              <ul className="divide-y">{items.map((t) => <TaskLine key={t.id} task={t} />)}</ul>
              <InfiniteSentinel active={!!q.hasNextPage} loading={q.isFetchingNextPage} onVisible={() => q.fetchNextPage()} />
              {!q.hasNextPage && items.length > 20 && <p className="text-muted-foreground pb-4 text-center text-xs">That's everything · {items.length} tasks</p>}
            </Card>}
      </div>
    </div>
  );
}
