/**
 * The editor shows friendly "@Name" text and remembers which people were picked;
 * on submit, those become the API's `@[Name](uuid)` markup.
 */
export type Picked = { id: string; name: string };

export function encodeMentions(text: string, picked: Picked[]) {
  let out = text;
  for (const p of [...picked].sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`@${p.name}`).join(`@[${p.name}](${p.id})`);
  }
  return out;
}

export function decodeMentions(body: string): { text: string; picked: Picked[] } {
  const picked: Picked[] = [];
  const text = body.replace(/@\[([^\]]+)\]\(([0-9a-f-]{36})\)/gi, (_m, name: string, id: string) => {
    picked.push({ id, name });
    return `@${name}`;
  });
  return { text, picked };
}

export type Segment = { kind: "text"; text: string } | { kind: "mention"; name: string; id: string };
export function segments(body: string): Segment[] {
  const out: Segment[] = [];
  const re = /@\[([^\]]+)\]\(([0-9a-f-]{36})\)/gi;
  let last = 0;
  for (const m of body.matchAll(re)) {
    if (m.index! > last) out.push({ kind: "text", text: body.slice(last, m.index) });
    out.push({ kind: "mention", name: m[1], id: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}
