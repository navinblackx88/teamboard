import { useState } from "react";
import { Pencil, Reply, Trash2 } from "lucide-react";
import { useCommentMutations, useComments, useMe } from "@/hooks/queries";
import { timeAgo } from "@/lib/format";
import { decodeMentions, encodeMentions, segments, type Picked } from "@/lib/mentions";
import type { Comment, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { MentionInput } from "./MentionInput";
import { UserAvatar, confirmAction } from "./common";

function Body({ body }: { body: string }) {
  return (
    <p className="text-foreground/90 text-sm break-words whitespace-pre-wrap">
      {segments(body).map((s, i) => s.kind === "text" ? <span key={i}>{s.text}</span>
        : <span key={i} className="bg-primary/10 text-primary rounded px-1 font-medium">@{s.name}</span>)}
    </p>
  );
}

function Composer({ users, onSubmit, busy, initial = "", onCancel, cta = "Comment", autoFocus }: {
  users: User[]; onSubmit: (body: string) => Promise<unknown>; busy: boolean; initial?: string; onCancel?: () => void; cta?: string; autoFocus?: boolean;
}) {
  const decoded = decodeMentions(initial);
  const [text, setText] = useState(decoded.text);
  const [picked, setPicked] = useState<Picked[]>(decoded.picked);
  const submit = async () => {
    if (!text.trim()) return;
    await onSubmit(encodeMentions(text.trim(), picked));
    setText(""); setPicked([]);
  };
  return (
    <div className="space-y-2">
      <MentionInput value={text} onChange={setText} picked={picked} onPick={setPicked} users={users} onSubmit={submit} autoFocus={autoFocus} />
      <div className="flex items-center justify-end gap-2">
        <span className="text-muted-foreground mr-auto hidden items-center gap-1 text-xs sm:inline-flex"><Kbd>⌘</Kbd><Kbd>Enter</Kbd> to send</span>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button size="sm" disabled={!text.trim() || busy} onClick={submit}>{busy && <Spinner />}{cta}</Button>
      </div>
    </div>
  );
}

export function CommentThread({ taskId, projectId, users, canComment, canModerate }: { taskId: string; projectId: string; users: User[]; canComment: boolean; canModerate: boolean }) {
  const { data, isLoading } = useComments(taskId);
  const m = useCommentMutations(taskId, projectId);
  if (isLoading) return <div className="flex justify-center py-6"><Spinner /></div>;
  return (
    <div className="space-y-4">
      {canComment && <Composer users={users} busy={m.create.isPending} onSubmit={(body) => m.create.mutateAsync({ body })} />}
      {!data?.items.length && <p className="text-muted-foreground py-4 text-center text-sm">No comments yet. Start the conversation.</p>}
      <ul className="space-y-4">
        {data?.items.map((c) => <CommentItem key={c.id} c={c} depth={0} users={users} m={m} canComment={canComment} canModerate={canModerate} />)}
      </ul>
    </div>
  );
}

function CommentItem({ c, depth, users, m, canComment, canModerate }: {
  c: Comment; depth: number; users: User[]; m: ReturnType<typeof useCommentMutations>; canComment: boolean; canModerate: boolean;
}) {
  const myId = useMe().data?.user.id;
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const mine = c.author?.id === myId;
  return (
    <li className={cn(depth > 0 && "border-l-2 pl-3")}>
      <div className="flex gap-2.5">
        {c.author ? <UserAvatar user={c.author} size={28} /> : <span className="bg-muted size-7 shrink-0 rounded-full" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium">{c.author?.name ?? "Former member"}</span>
            <span className="text-muted-foreground text-xs">{timeAgo(c.createdAt)}{c.editedAt && " · edited"}</span>
          </div>
          {c.deletedAt ? <p className="text-muted-foreground text-sm italic">Comment deleted</p>
            : editing ? <div className="mt-1"><Composer users={users} initial={c.body} cta="Save" busy={m.edit.isPending} autoFocus onCancel={() => setEditing(false)}
                onSubmit={async (body) => { await m.edit.mutateAsync({ id: c.id, body }); setEditing(false); }} /></div>
            : <Body body={c.body} />}
          {!c.deletedAt && !editing && (
            <div className="text-muted-foreground mt-1 flex gap-3 text-xs">
              {canComment && depth < 3 && <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setReplying((r) => !r)}><Reply className="size-3" />Reply</button>}
              {mine && <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setEditing(true)}><Pencil className="size-3" />Edit</button>}
              {(mine || canModerate) && <button className="hover:text-destructive inline-flex items-center gap-1" onClick={async () => (await confirmAction({ title: "Delete this comment?", confirmLabel: "Delete", destructive: true })) && m.remove.mutate(c.id)}><Trash2 className="size-3" />Delete</button>}
            </div>
          )}
          {replying && <div className="mt-2"><Composer users={users} cta="Reply" autoFocus busy={m.create.isPending} onCancel={() => setReplying(false)}
            onSubmit={async (body) => { await m.create.mutateAsync({ body, parentId: c.id }); setReplying(false); }} /></div>}
        </div>
      </div>
      {c.replies.length > 0 && <ul className="mt-3 ml-9 space-y-3">{c.replies.map((r) => <CommentItem key={r.id} c={r} depth={depth + 1} users={users} m={m} canComment={canComment} canModerate={canModerate} />)}</ul>}
    </li>
  );
}
