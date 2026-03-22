import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { AMBIENT_TRACKS } from "../constants/ambientTracks";

interface AtmosphereState {
  isEnabled: boolean;
  selectedTrackId: string;
  volume: number;
  isSuppressed: boolean;

  setEnabled: (enabled: boolean) => void;
  setSelectedTrackId: (id: string) => void;
  setVolume: (volume: number) => void;
  setSuppressed: (suppressed: boolean) => void;
  reset: () => void;
}

export const useAtmosphereStore = create<AtmosphereState>()(
  devtools(
    persist(
      (set) => ({
        isEnabled: false,
        selectedTrackId: AMBIENT_TRACKS[0]?.id || "",
        volume: 0.5,
        isSuppressed: false,

        setEnabled: (enabled) => set({ isEnabled: enabled }),
        setSelectedTrackId: (id) => set({ selectedTrackId: id }),
        setVolume: (volume) => set({ volume }),
        setSuppressed: (suppressed) => set({ isSuppressed: suppressed }),
        reset: () =>
          set({
            isEnabled: false,
            selectedTrackId: AMBIENT_TRACKS[0]?.id || "",
            volume: 0.5,
            isSuppressed: false,
          }),
      }),
      {
        name: "kumiho-atmosphere-storage",
        // isSuppressed만 제외하고 유지
        partialize: (state) => ({
          isEnabled: state.isEnabled,
          selectedTrackId: state.selectedTrackId,
          volume: state.volume,
        }),
      },
    ),
    { name: "kumiho-atmosphere" },
  ),
);
