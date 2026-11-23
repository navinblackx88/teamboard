import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import type { Burndown, Velocity } from "@/lib/types";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Series colours come from --chart-1 (blue) / --chart-2 (orange): validated with the dataviz palette
// checker for colour-blind separation and >=3:1 contrast, with separate steps for light and dark mode.
const burndownConfig = {
  ideal: { label: "Ideal", color: "var(--chart-2)" },
  remaining: { label: "Remaining", color: "var(--chart-1)" },
} satisfies ChartConfig;
const velocityConfig = {
  committed: { label: "Committed", color: "var(--chart-2)" },
  completed: { label: "Completed", color: "var(--chart-1)" },
} satisfies ChartConfig;

function Frame({ caption, children, table }: { caption: ReactNode; children: ReactNode; table: ReactNode }) {
  const [view, setView] = useState("chart");
  return (
    <figure>
      <figcaption className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{caption}</span>
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="h-7">
            <TabsTrigger value="chart" className="px-2 text-xs">Chart</TabsTrigger>
            <TabsTrigger value="table" className="px-2 text-xs">Table</TabsTrigger>
          </TabsList>
        </Tabs>
      </figcaption>
      {view === "chart" ? children : <div className="max-h-72 overflow-auto rounded-md border">{table}</div>}
    </figure>
  );
}

export function BurndownChart({ data }: { data: Burndown }) {
  const rows = data.days.map((d) => ({ ...d, label: format(new Date(d.date), "d MMM") }));
  const today = rows.filter((r) => r.remaining !== null).at(-1);
  return (
    <Frame
      caption={<>Story points remaining · {data.committedPoints} committed{data.scopePoints !== data.committedPoints && ` · scope now ${data.scopePoints}`}</>}
      table={
        <Table>
          <TableHeader className="bg-muted/50 sticky top-0"><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Ideal</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="text-right">Completed</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((r) => (
            <TableRow key={r.date}><TableCell>{r.label}</TableCell><TableCell className="text-right tabular-nums">{r.ideal}</TableCell><TableCell className="text-right tabular-nums">{r.remaining ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{r.completed ?? "—"}</TableCell></TableRow>
          ))}</TableBody>
        </Table>
      }
    >
      <ChartContainer config={burndownConfig} className="aspect-auto h-72 w-full">
        <LineChart data={rows} margin={{ top: 8, right: 16, left: -16, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
          <ChartTooltip cursor content={<ChartTooltipContent indicator="line" />} />
          <ChartLegend content={<ChartLegendContent />} />
          {today && <ReferenceLine x={today.label} stroke="var(--border)" strokeDasharray="2 3" label={{ value: "Today", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }} />}
          <Line dataKey="ideal" stroke="var(--color-ideal)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          <Line dataKey="remaining" stroke="var(--color-remaining)" strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: "var(--background)" }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ChartContainer>
    </Frame>
  );
}

export function VelocityChart({ data }: { data: Velocity }) {
  return (
    <Frame
      caption={<>Story points per completed sprint · average <b className="text-foreground">{data.averageVelocity}</b></>}
      table={
        <Table>
          <TableHeader className="bg-muted/50"><TableRow><TableHead>Sprint</TableHead><TableHead className="text-right">Committed</TableHead><TableHead className="text-right">Completed</TableHead></TableRow></TableHeader>
          <TableBody>{data.items.map((r) => (
            <TableRow key={r.id}><TableCell>{r.name}</TableCell><TableCell className="text-right tabular-nums">{r.committed}</TableCell><TableCell className="text-right tabular-nums">{r.completed}</TableCell></TableRow>
          ))}</TableBody>
        </Table>
      }
    >
      <ChartContainer config={velocityConfig} className="aspect-auto h-72 w-full">
        <BarChart data={data.items} margin={{ top: 8, right: 16, left: -16, bottom: 0 }} barGap={2} barCategoryGap="28%" accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <ReferenceLine y={data.averageVelocity} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: `avg ${data.averageVelocity}`, position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 11 }} />
          <Bar dataKey="committed" fill="var(--color-committed)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          <Bar dataKey="completed" fill="var(--color-completed)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </Frame>
  );
}
