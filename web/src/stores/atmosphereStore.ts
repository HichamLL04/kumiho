import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { AMBIENT_TRACKS } from "../constants/ambientTracks";

interface AtmosphereState {
  isEnabled: boolean;
  selectedTrackId: string;
  volume: number;
  suppressedBy: Record<string, boolean>;
  timerMinutes: number | null;
  timerEndAt: number | null;

  setEnabled: (enabled: boolean) => void;
  setSelectedTrackId: (id: string) => void;
  setVolume: (volume: number) => void;
  setSuppressedBy: (source: string, suppressed: boolean) => void;
  setTimer: (minutes: number | null) => void;
  reset: () => void;
}

export const useAtmosphereStore = create<AtmosphereState>()(
  devtools(
    persist(
      (set) => ({
        isEnabled: false,
        selectedTrackId: AMBIENT_TRACKS[0]?.id || "",
        volume: 0.5,
        suppressedBy: {},
        timerMinutes: null,
        timerEndAt: null,

        setEnabled: (enabled) => set({ isEnabled: enabled }),
        setSelectedTrackId: (id) => set({ selectedTrackId: id }),
        setVolume: (volume) => set({ volume }),
        setSuppressedBy: (source, suppressed) =>
          set((state) => {
            const next = { ...state.suppressedBy };
            if (suppressed) {
              next[source] = true;
            } else {
              delete next[source];
            }
            return { suppressedBy: next };
          }),
        setTimer: (minutes) => {
          if (minutes === null) {
            set({ timerMinutes: null, timerEndAt: null });
          } else {
            const endAt = Date.now() + minutes * 60 * 1000;
            set({ timerMinutes: minutes, timerEndAt: endAt });
          }
        },
        reset: () =>
          set({
            isEnabled: false,
            selectedTrackId: AMBIENT_TRACKS[0]?.id || "",
            volume: 0.5,
            suppressedBy: {},
            timerMinutes: null,
            timerEndAt: null,
          }),
      }),
      {
        name: "kumiho-atmosphere-storage",
        // suppressedBy는 런타임 전용이므로 제외
        partialize: (state) => ({
          isEnabled: state.isEnabled,
          selectedTrackId: state.selectedTrackId,
          volume: state.volume,
          timerMinutes: state.timerMinutes,
          timerEndAt: state.timerEndAt,
        }),
        onRehydrateStorage: () => (state) => {
          if (!state) return;
          // 저장된 selectedTrackId가 현재 트랙 목록에 없으면 첫 번째 트랙으로 교정
          if (!AMBIENT_TRACKS.some((t) => t.id === state.selectedTrackId)) {
            state.selectedTrackId = AMBIENT_TRACKS[0]?.id || "";
          }
        },
      },
    ),
    { name: "kumiho-atmosphere" },
  ),
);
