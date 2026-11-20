import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { Label, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LabelChip, UserAvatar } from "./common";

/** A trigger that looks like a property value; bordered when used inside a form. */
function PickerTrigger({ children, disabled, bordered, label }: { children: ReactNode; disabled?: boolean; bordered?: boolean; label: string }) {
  return (
    <PopoverTrigger asChild disabled={disabled}>
      <button type="button" aria-label={label}
        className={cn("flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default",
          bordered ? "border-input dark:bg-input/30 border shadow-xs" : "enabled:hover:bg-accent")}>
        {children}
      </button>
    </PopoverTrigger>
  );
}

export function UserMultiPicker({ users, value, onChange, disabled, placeholder = "Unassigned", bordered }: {
  users: User[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; placeholder?: string; bordered?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = users.filter((u) => value.includes(u.id));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PickerTrigger disabled={disabled} bordered={bordered} label="Assignees">
        {selected.length
          ? selected.map((u) => <span key={u.id} className="inline-flex items-center gap-1.5"><UserAvatar user={u} size={20} />{u.name}</span>)
          : <span className="text-muted-foreground">{placeholder}</span>}
      </PickerTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search people" />
          <CommandList>
            <CommandEmpty>No matches</CommandEmpty>
            <CommandGroup>
              {users.map((u) => {
                const on = value.includes(u.id);
                return (
                  <CommandItem key={u.id} value={`${u.name} ${u.email}`} onSelect={() => onChange(on ? value.filter((v) => v !== u.id) : [...value, u.id])}>
                    <UserAvatar user={u} size={22} /><span className="min-w-0 flex-1 truncate">{u.name}</span>
                    <Check className={cn("text-primary!", on ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function LabelPicker({ labels, value, onChange, disabled, bordered }: { labels: Label[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; bordered?: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = labels.filter((l) => value.includes(l.id));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PickerTrigger disabled={disabled} bordered={bordered} label="Labels">
        {selected.length ? selected.map((l) => <LabelChip key={l.id} label={l} />) : <span className="text-muted-foreground">None</span>}
      </PickerTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandInput placeholder="Filter labels" />
          <CommandList>
            <CommandEmpty>No labels</CommandEmpty>
            <CommandGroup>
              {labels.map((l) => {
                const on = value.includes(l.id);
                return (
                  <CommandItem key={l.id} value={l.name} onSelect={() => onChange(on ? value.filter((v) => v !== l.id) : [...value, l.id])}>
                    <span className="size-3 rounded-full" style={{ backgroundColor: l.color }} /><span className="flex-1">{l.name}</span>
                    <Check className={cn("text-primary!", on ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Radix Select can't hold an empty-string value, so "" is mapped to a sentinel. */
const NONE = "__none__";

/** shadcn Select styled to sit inline in property lists (ghost trigger). */
export function InlineSelect<T extends string>({ value, onChange, options, disabled, className, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; disabled?: boolean; className?: string; label?: string;
}) {
  return (
    <Select disabled={disabled} value={value === "" ? NONE : value} onValueChange={(v) => onChange((v === NONE ? "" : v) as T)}>
      <SelectTrigger aria-label={label} className={cn("w-full border-transparent shadow-none hover:bg-accent dark:bg-transparent disabled:opacity-100 disabled:hover:bg-transparent", disabled && "[&>svg]:hidden", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value || NONE} value={o.value === "" ? NONE : o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
