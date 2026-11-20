import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast as sonner } from "sonner";

type UiState = {
  workspaceId: string | null;
  setWorkspace: (id: string | null) => void;
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      workspaceId: null,
      setWorkspace: (workspaceId) => set({ workspaceId }),
    }),
    { name: "teamboard-ui", partialize: (s) => ({ workspaceId: s.workspaceId }) },
  ),
);

/** Navigation hook for toast actions, registered by the app shell (keeps toasts usable outside React). */
let navigateTo: (href: string) => void = (href) => window.location.assign(href);
export const setToastNavigator = (fn: (href: string) => void) => { navigateTo = fn; };

/** Thin wrapper over shadcn's Sonner toaster; the call signature predates it, so hooks stay unchanged. */
export const toast = {
  info: (title: string, body?: string, href?: string) =>
    sonner(title, { description: body, action: href ? { label: "Open", onClick: () => navigateTo(href) } : undefined }),
  success: (title: string, body?: string) => sonner.success(title, { description: body }),
  error: (title: string, body?: string) => sonner.error(title, { description: body, duration: 6000 }),
};
