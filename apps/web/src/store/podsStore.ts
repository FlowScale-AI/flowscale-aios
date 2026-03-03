import { create } from "zustand";

// EIOS: local pod instance — a running ComfyUI process on a port
export interface LocalPodInstance {
  id: string;
  port: number;
  status: "running" | "stopped" | "error";
  baseUrl?: string;
}

// EIOS: a "pod" groups one or more ComfyUI instances (ports)
export interface LocalPod {
  id: string;
  name: string;
  instances: LocalPodInstance[];
}

const OPERATOR_URL_KEY = "flowscale:operatorUrl";

const storedOperatorUrl =
  typeof window !== "undefined"
    ? (localStorage.getItem(OPERATOR_URL_KEY) ?? null)
    : null;

interface PodsState {
  pods: LocalPod[];
  selectedPodId: string | null;
  isLoading: boolean;
  /** Remote operator URL. In EIOS this is always null — execution goes through /api/comfy proxy. */
  operatorUrl: string | null;
  setSelectedPodId: (id: string | null) => void;
  setOperatorUrl: (url: string | null) => void;
  refreshPods: () => Promise<void>;
}

export const usePodsStore = create<PodsState>((set, get) => ({
  pods: [],
  selectedPodId: null,
  isLoading: false,
  operatorUrl: storedOperatorUrl,

  setSelectedPodId: (id) => set({ selectedPodId: id }),

  setOperatorUrl: (url) => {
    const normalized = url?.trim() || null;
    if (typeof window !== "undefined") {
      if (normalized) {
        localStorage.setItem(OPERATOR_URL_KEY, normalized);
      } else {
        localStorage.removeItem(OPERATOR_URL_KEY);
      }
    }
    set({ operatorUrl: normalized, pods: [], selectedPodId: null });
    get().refreshPods();
  },

  refreshPods: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/comfy/scan");
      if (!res.ok) { set({ isLoading: false }); return; }
      const instances: Array<{ port: number; status: string }> = await res.json();
      const running = instances.filter((i) => i.status === "running");

      if (running.length === 0) {
        set({ pods: [], selectedPodId: null, isLoading: false });
        return;
      }

      // One virtual pod per instance so the existing selector UI works
      const pods: LocalPod[] = running.map((i) => ({
        id: `local:${i.port}`,
        name: `ComfyUI :${i.port}`,
        instances: [{
          id: `local:${i.port}`,
          port: i.port,
          status: "running",
        }],
      }));

      set((state) => ({
        pods,
        selectedPodId: state.selectedPodId ?? pods[0].id,
        isLoading: false,
      }));
    } catch (err) {
      console.error("[PodsStore] Failed to refresh pods:", err);
      set({ isLoading: false });
    }
  },
}));
