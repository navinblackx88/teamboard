import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity, Check, ChevronsUpDown, FolderKanban, KanbanSquare, LayoutDashboard, ListTodo, LogOut, Monitor, Moon, Plus,
  Search, Settings, SquareKanban, Sun, Timer, UserCircle, Users,
} from "lucide-react";
import { useMe, useProjects, useWorkspace } from "@/hooks/queries";
import { useWorkspaceRealtime } from "@/hooks/useRealtime";
import { api } from "@/lib/api";
import { disconnectRealtime } from "@/lib/realtime";
import { ROLE_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { setToastNavigator, useUi } from "@/stores/ui";
import { useTheme, type Theme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupAction, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  SidebarProvider, SidebarRail, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { NotificationBell } from "./NotificationBell";
import { PageSpinner, UserAvatar } from "./common";

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    const { refreshToken, clear } = useAuth.getState();
    if (refreshToken) await api("/auth/logout", { body: { refreshToken } }).catch(() => undefined);
    clear();
    disconnectRealtime();
    qc.clear();
    navigate("/login");
  };
}

/** Authenticated shell. Picks a workspace (or sends you to create one) and wires real-time. */
export function AppLayout() {
  const { data, isLoading } = useMe();
  const { workspaceId, setWorkspace } = useUi();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => setToastNavigator(navigate), [navigate]);
  // Keep the selected workspace valid.
  useEffect(() => {
    if (!data) return;
    if (!data.workspaces.some((w) => w.id === workspaceId)) setWorkspace(data.workspaces[0]?.id ?? null);
  }, [data, workspaceId, setWorkspace]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const live = useWorkspaceRealtime(workspaceId);

  if (isLoading || !data) return <PageSpinner />;
  if (!data.workspaces.length) return <Navigate to="/onboarding" replace />;
  if (!workspaceId) return <PageSpinner />;

  return (
    <SidebarProvider className="h-svh">
      <AppSidebar />
      <SidebarInset className="min-w-0 overflow-hidden">
        <header className="bg-background flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
          <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)}
            className="text-muted-foreground w-full max-w-64 justify-start gap-2 font-normal shadow-none sm:w-64">
            <Search /><span className="truncate">Search or jump to…</span>
            <Kbd className="ml-auto hidden sm:inline-flex">⌘K</Kbd>
          </Button>
          <div className="flex-1" />
          <Badge variant="outline" className={cn("hidden gap-1.5 sm:inline-flex", live ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}
            title={live ? "Real-time updates connected" : "Reconnecting…"}>
            <span className={cn("size-2 rounded-full", live ? "bg-emerald-500" : "bg-muted-foreground/40")} />{live ? "Live" : "Offline"}
          </Badge>
          <NotificationBell />
          <UserMenu />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </SidebarInset>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarProvider>
  );
}

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/my-tasks", label: "My tasks", icon: ListTodo },
  { to: "/projects", label: "Projects", icon: FolderKanban, end: true },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/members", label: "Members", icon: Users },
];

function AppSidebar() {
  const { workspaceId } = useUi();
  const { data: ws } = useWorkspace(workspaceId);
  const { data: projects } = useProjects(workspaceId);
  const { isMobile, setOpenMobile } = useSidebar();
  const location = useLocation();
  const pid = useMatch("/projects/:pid/*")?.params.pid;
  const active = projects?.filter((p) => p.status === "active") ?? [];
  const isActive = (to: string, end?: boolean) => (end ? location.pathname === to : location.pathname.startsWith(to));

  // Close the mobile sheet after navigating.
  useEffect(() => { if (isMobile) setOpenMobile(false); }, [location.pathname, isMobile, setOpenMobile]);

  const nav = [...NAV, ...(ws?.permissions.includes("workspace:update") ? [{ to: "/settings", label: "Settings", icon: Settings }] : [])];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader><WorkspaceSwitcher /></SidebarHeader>
      <SidebarContent className="scroll-thin">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((n) => (
                <SidebarMenuItem key={n.to}>
                  <SidebarMenuButton asChild isActive={isActive(n.to, "end" in n && n.end)} tooltip={n.label}>
                    <NavLink to={n.to} end={"end" in n && n.end}><n.icon /><span>{n.label}</span></NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          {ws?.permissions.includes("project:create") && (
            <SidebarGroupAction asChild title="New project">
              <Link to="/projects?new=1" aria-label="New project"><Plus /></Link>
            </SidebarGroupAction>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {active.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton asChild isActive={pid === p.id} tooltip={p.name}>
                    <Link to={`/projects/${p.id}/board`}>
                      <span className="flex size-4 items-center justify-center"><span className="size-2.5 rounded-[3px]" style={{ backgroundColor: p.color }} /></span>
                      <span>{p.name}</span>
                    </Link>
                  </SidebarMenuButton>
                  {pid === p.id && (
                    <SidebarMenuSub>
                      {[
                        { to: `/projects/${p.id}/board`, label: "Board", icon: KanbanSquare },
                        { to: `/projects/${p.id}/sprints`, label: "Sprints", icon: Timer },
                        { to: `/projects/${p.id}/settings`, label: "Settings", icon: Settings },
                      ].map((s) => (
                        <SidebarMenuSubItem key={s.to}>
                          <SidebarMenuSubButton asChild isActive={location.pathname === s.to}>
                            <NavLink to={s.to}><s.icon /><span>{s.label}</span></NavLink>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              ))}
              {!active.length && <p className="text-muted-foreground px-2 py-1 text-xs group-data-[collapsible=icon]:hidden">No projects yet</p>}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {ws && (
        <SidebarFooter className="group-data-[collapsible=icon]:hidden">
          <div className="text-muted-foreground px-2 py-1 text-xs">Your role: <span className="text-foreground font-medium">{ROLE_LABEL[ws.role]}</span></div>
        </SidebarFooter>
      )}
      <SidebarRail />
    </Sidebar>
  );
}

function WorkspaceSwitcher() {
  const { data } = useMe();
  const { workspaceId, setWorkspace } = useUi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const current = data?.workspaces.find((w) => w.id === workspaceId);
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <SquareKanban className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{current?.name ?? "TeamBoard"}</span>
                <span className="text-muted-foreground truncate text-xs">{current ? ROLE_LABEL[current.role] : "Workspace"}</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" align="start">
            <DropdownMenuLabel className="text-muted-foreground text-xs">Workspaces</DropdownMenuLabel>
            {data?.workspaces.map((w) => (
              <DropdownMenuItem key={w.id} onSelect={() => { setWorkspace(w.id); qc.removeQueries({ queryKey: ["board"] }); navigate("/dashboard"); }}>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === workspaceId && <Check className="text-primary!" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link to="/onboarding"><Plus />New workspace</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function UserMenu() {
  const { data } = useMe();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();
  if (!data) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu"><UserAvatar user={data.user} size={32} /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{data.user.name}</p>
          <p className="text-muted-foreground truncate text-xs">{data.user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to="/profile"><UserCircle />Profile</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light"><Sun />Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon />Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor />System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout}><LogOut />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { workspaceId } = useUi();
  const { data: projects = [] } = useProjects(workspaceId);
  const { setTheme } = useTheme();
  const navigate = useNavigate();
  const go = (to: string) => { onOpenChange(false); navigate(to); };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Jump to" description="Search pages and projects">
      <CommandInput placeholder="Type a page or project name…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {[...NAV, { to: "/settings", label: "Workspace settings", icon: Settings }, { to: "/profile", label: "Profile", icon: UserCircle }].map((n) => (
            <CommandItem key={n.to} onSelect={() => go(n.to)}><n.icon />{n.label}</CommandItem>
          ))}
        </CommandGroup>
        {projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {projects.filter((p) => p.status === "active").flatMap((p) => [
                <CommandItem key={`${p.id}-b`} value={`${p.name} board ${p.key}`} onSelect={() => go(`/projects/${p.id}/board`)}>
                  <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: p.color }} />{p.name}<span className="text-muted-foreground ml-auto text-xs">Board</span>
                </CommandItem>,
                <CommandItem key={`${p.id}-s`} value={`${p.name} sprints ${p.key}`} onSelect={() => go(`/projects/${p.id}/sprints`)}>
                  <Timer />{p.name}<span className="text-muted-foreground ml-auto text-xs">Sprints</span>
                </CommandItem>,
              ])}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => { setTheme("light"); onOpenChange(false); }}><Sun />Light theme</CommandItem>
          <CommandItem onSelect={() => { setTheme("dark"); onOpenChange(false); }}><Moon />Dark theme</CommandItem>
          <CommandItem onSelect={() => { setTheme("system"); onOpenChange(false); }}><Monitor />System theme</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export function PageHeader({ title, subtitle, actions, children }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="bg-background border-b px-4 pt-5 pb-4 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="text-muted-foreground mt-0.5 text-sm">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
