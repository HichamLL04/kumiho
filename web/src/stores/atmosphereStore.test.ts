import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AMBIENT_TRACKS } from "../constants/ambientTracks";
import { useAtmosphereStore } from "./atmosphereStore";

describe("useAtmosphereStore rehydrate", () => {
  const storageKey = "kumiho-atmosphere-storage";
  const defaultTrackId = AMBIENT_TRACKS[0]?.id || "";

  beforeEach(() => {
    localStorage.clear();
    useAtmosphereStore.getState().reset();
  });

  afterEach(() => {
    useAtmosphereStore.getState().reset();
    localStorage.clear();
  });

  it("비활성 상태로 리하이드레이트되면 저장된 타이머를 제거한다", async () => {
    const futureTimerEndAt = Date.now() + 15 * 60 * 1000;

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        state: {
          selectedTrackId: defaultTrackId,
          volume: 0.5,
          timerMinutes: 15,
          timerEndAt: futureTimerEndAt,
        },
        version: 0,
      }),
    );

    await useAtmosphereStore.persist.rehydrate();

    const state = useAtmosphereStore.getState();

    expect(state.isEnabled).toBe(false);
    expect(state.timerMinutes).toBeNull();
    expect(state.timerEndAt).toBeNull();
  });

  it("저장된 트랙이 현재 목록에 없으면 첫 번째 트랙으로 교정한다", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        state: {
          selectedTrackId: "unknown-track",
          volume: 0.5,
          timerMinutes: null,
          timerEndAt: null,
        },
        version: 0,
      }),
    );

    await useAtmosphereStore.persist.rehydrate();

    expect(useAtmosphereStore.getState().selectedTrackId).toBe(defaultTrackId);
  });

  it("레거시 저장값에 isEnabled가 남아 있어도 비활성 상태로 정리한다", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        state: {
          isEnabled: true,
          selectedTrackId: defaultTrackId,
          volume: 0.5,
          timerMinutes: 15,
          timerEndAt: Date.now() + 15 * 60 * 1000,
        },
        version: 0,
      }),
    );

    await useAtmosphereStore.persist.rehydrate();

    const state = useAtmosphereStore.getState();

    expect(state.isEnabled).toBe(false);
    expect(state.timerMinutes).toBeNull();
    expect(state.timerEndAt).toBeNull();
  });
});
