import { Fragment, type ReactNode } from "react";

/**
 * Small, safe Markdown subset for task descriptions: headings, bullet/numbered lists,
 * **bold**, *italic*, `code` and links. Renders React nodes (no innerHTML), so it can't inject markup.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={blocks.length} className={list.ordered ? "my-1 list-decimal pl-5" : "my-1 list-disc pl-5"}>{list.items.map((i, k) => <li key={k}>{inline(i)}</li>)}</Tag>);
    list = null;
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line), num = /^\s*\d+[.)]\s+(.*)$/.exec(line), h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = !!num;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    if (h) blocks.push(<p key={blocks.length} className="mt-2 font-semibold">{inline(h[2])}</p>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    else blocks.push(<div key={blocks.length} className="h-2" />);
  }
  flush();
  return <div className="space-y-0.5 text-foreground/90 text-sm">{blocks}</div>;
}

function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.map((p, i) => {
    if (/^\*\*.+\*\*$/.test(p)) return <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
    if (/^`.+`$/.test(p)) return <code key={i} className="bg-muted rounded px-1 py-0.5 text-[0.85em]">{p.slice(1, -1)}</code>;
    if (/^\*.+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(p);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{link[1]}</a>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
