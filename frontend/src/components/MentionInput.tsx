import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Picked } from "@/lib/mentions";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "./common";

/**
 * Textarea with @mention autocomplete. Type "@" and a few letters, pick with ↑/↓ + Enter (or click).
 * The text keeps a readable "@Name"; `picked` records who each mention refers to.
 */
export function MentionInput({ value, onChange, picked, onPick, users, onSubmit, placeholder, autoFocus }: {
  value: string; onChange: (v: string) => void; picked: Picked[]; onPick: (p: Picked[]) => void;
  users: User[]; onSubmit?: () => void; placeholder?: string; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  // Caret position to restore after a mention is inserted; applied synchronously after React commits
  // the new value, so keystrokes typed immediately afterwards land after the mention.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return users.filter((u) => u.name.toLowerCase().split(/\s+/).some((part) => part.startsWith(q)) || u.name.toLowerCase().startsWith(q)).slice(0, 6);
  }, [query, users]);

  const detect = (text: string, caret: number) => {
    const m = /(?:^|\s)@([\p{L}\p{N}_.-]{0,30})$/u.exec(text.slice(0, caret));
    setQuery(m ? m[1] : null);
    setActive(0);
  };

  const choose = (u: User) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([\p{L}\p{N}_.-]{0,30})$/u, `@${u.name} `);
    const next = before + value.slice(caret);
    pendingCaret.current = before.length;
    onChange(next);
    if (!picked.some((p) => p.id === u.id)) onPick([...picked, { id: u.id, name: u.name }]);
    setQuery(null);
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        autoFocus={autoFocus}
        className="min-h-20 resize-y"
        placeholder={placeholder ?? "Write a comment… use @ to mention someone"}
        value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onClick={(e) => detect(value, e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (matches.length && query !== null) {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[active]); return; }
            if (e.key === "Escape") { setQuery(null); return; }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit?.(); }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        aria-autocomplete="list"
      />
      {query !== null && matches.length > 0 && (
        <ul role="listbox" className="bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 absolute bottom-full left-0 z-50 mb-1 w-64 rounded-md border p-1 shadow-md">
          {matches.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); choose(u); }}
                className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm", i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}>
                <UserAvatar user={u} size={22} /><span className="truncate">{u.name}</span><span className="text-muted-foreground ml-auto truncate text-xs">{u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
