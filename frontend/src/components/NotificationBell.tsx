import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AtSign, Bell, CalendarClock, CheckCheck, Flag, MessageSquare, UserPlus, UserRoundCheck } from "lucide-react";
import { useNotificationMutations, useNotifications, useUnreadCount } from "@/hooks/queries";
import { timeAgo } from "@/lib/format";
import type { NotificationType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { InfiniteSentinel } from "./common";

const ICON: Record<NotificationType, ReactNode> = {
  task_assigned: <UserRoundCheck className="text-primary size-4" />,
  comment_added: <MessageSquare className="size-4 text-sky-600 dark:text-sky-400" />,
  mentioned: <AtSign className="size-4 text-violet-600 dark:text-violet-400" />,
  deadline_approaching: <CalendarClock className="size-4 text-orange-600 dark:text-orange-400" />,
  invited: <UserPlus className="size-4 text-emerald-600 dark:text-emerald-400" />,
  sprint_started: <Flag className="size-4 text-emerald-600 dark:text-emerald-400" />,
  sprint_completed: <Flag className="text-muted-foreground size-4" />,
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: unread = 0 } = useUnreadCount();
  const list = useNotifications(open);
  const { read, readAll } = useNotificationMutations();
  const navigate = useNavigate();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="bg-destructive absolute top-1 right-1 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[75vh] w-[calc(100vw-1rem)] flex-col p-0 sm:w-96">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="font-semibold">Notifications</span>
          <Button variant="link" size="sm" className="h-auto px-0 text-xs" disabled={!unread} onClick={() => readAll.mutate()}>
            <CheckCheck className="size-3.5" />Mark all read
          </Button>
        </div>
        <div className="scroll-thin overflow-y-auto">
          {list.isLoading && <div className="flex justify-center p-6"><Spinner /></div>}
          {!list.isLoading && !items.length && <p className="text-muted-foreground p-8 text-center text-sm">You're all caught up.</p>}
          {items.map((n) => (
            <button key={n.id} onClick={() => { if (!n.readAt) read.mutate(n.id); if (n.link) navigate(n.link); setOpen(false); }}
              className={cn("hover:bg-accent flex w-full gap-3 border-b px-4 py-3 text-left last:border-0", !n.readAt && "bg-primary/5")}>
              <span className="mt-0.5">{ICON[n.type]}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm", !n.readAt ? "font-medium" : "text-foreground/80")}>{n.title}</span>
                {n.body && <span className="text-muted-foreground mt-0.5 block truncate text-xs">{n.body}</span>}
                <span className="text-muted-foreground mt-1 block text-[11px]">{timeAgo(n.createdAt)}</span>
              </span>
              {!n.readAt && <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" />}
            </button>
          ))}
          <InfiniteSentinel active={!!list.hasNextPage} loading={list.isFetchingNextPage} onVisible={() => list.fetchNextPage()} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
