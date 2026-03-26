import { create } from "zustand";
import { libraryAPI } from "../api/client";
import type { LibraryType } from "../types/series";

export interface Library {
  id: string;
  name: string;
  paths: string[];
  default_view_mode: string;
  default_read_direction: string;
  default_page_transition: string;
  default_epub_render_mode: string;
  default_epub_theme: string;
  default_epub_spread: string;
  default_epub_wheel_direction: string;
  default_epub_keyboard_direction: string;
  default_epub_click_direction: string;
  sort_order: number;
  scan_status: "IDLE" | "SCANNING" | "ERROR";
  last_scan_result: string;
  type?: "LOCAL" | "SYSTEM";
  is_visible?: boolean;
  library_type?: LibraryType;
  scan_excludes?: string;
}

interface LibraryState {
  libraries: Library[];
  isLoading: boolean;
  error: string | null;
  refreshKey: number;
  fetchRequestId: number;
  fetchLibraries: (showLoading?: boolean) => Promise<void>;
  setLibraries: (libraries: Library[]) => void;
  triggerRefresh: () => void;
  clearError: () => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  libraries: [],
  isLoading: false,
  error: null,
  refreshKey: 0,
  fetchRequestId: 0,
  fetchLibraries: async (showLoading = true) => {
    let currentRequestId = 0;
    set((state) => {
      currentRequestId = state.fetchRequestId + 1;
      return {
        fetchRequestId: currentRequestId,
        isLoading: showLoading ? true : state.isLoading,
        error: null,
      };
    });

    try {
      const response = await libraryAPI.getAll();
      set((state) => {
        if (state.fetchRequestId === currentRequestId) {
          return {
            libraries: response.data.libraries || [],
            isLoading: false,
          };
        }
        return {};
      });
    } catch (error: unknown) {
      console.error("Failed to fetch libraries:", error);
      const errorMessage = error instanceof Error ? error.message : "라이브러리 목록을 가져오는 데 실패했습니다.";
      set((state) => {
        if (state.fetchRequestId === currentRequestId) {
          return {
            isLoading: false,
            error: errorMessage,
          };
        }
        return {};
      });
    }
  },
  setLibraries: (libraries) => set({ libraries }),
  triggerRefresh: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),
  clearError: () => set({ error: null }),
}));
