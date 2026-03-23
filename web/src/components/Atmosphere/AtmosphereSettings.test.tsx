import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtmosphereSettings } from "./AtmosphereSettings";
import { AMBIENT_TRACKS } from "../../constants/ambientTracks";
import { useAtmosphereStore } from "../../stores/atmosphereStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { minutes?: number }) => {
      if (key === "header.atmosphere_timer_remaining") {
        return `${options?.minutes ?? 0}분 남음`;
      }
      return key;
    },
  }),
}));

vi.mock("../../stores/atmosphereStore", () => ({
  useAtmosphereStore: vi.fn(),
}));

vi.mock("zustand/react/shallow", () => ({
  useShallow: <T,>(fn: (state: T) => T) => fn,
}));

describe("AtmosphereSettings", () => {
  const defaultTrackId = AMBIENT_TRACKS[0]?.id || "";
  const baseState = {
    isEnabled: true,
    selectedTrackId: defaultTrackId,
    volume: 0.5,
    timerMinutes: null,
    timerEndAt: null as number | null,
    suppressedBy: {},
    setEnabled: vi.fn(),
    setSelectedTrackId: vi.fn(),
    setVolume: vi.fn(),
    setTimer: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("타이머 종료 시각이 없으면 interval을 등록하지 않음", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    vi.mocked(useAtmosphereStore).mockReturnValue(baseState);

    render(<AtmosphereSettings />);

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("타이머 종료 시각이 있으면 interval을 등록함", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    vi.mocked(useAtmosphereStore).mockReturnValue({
      ...baseState,
      timerMinutes: 30,
      timerEndAt: Date.now() + 30 * 60 * 1000,
    });

    render(<AtmosphereSettings />);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
  });

  it("타이머 종료 시각이 없으면 잔여 시간 문구를 렌더링하지 않음", () => {
    vi.mocked(useAtmosphereStore).mockReturnValue(baseState);

    render(<AtmosphereSettings />);

    expect(screen.queryByText(/분 남음/)).not.toBeInTheDocument();
  });

  it("타이머가 해제되면 이전 잔여 시간 문구를 즉시 숨김", () => {
    const futureTimerEndAt = Date.now() + 30 * 60 * 1000;

    vi.mocked(useAtmosphereStore).mockReturnValue({
      ...baseState,
      timerMinutes: 30,
      timerEndAt: futureTimerEndAt,
    });

    const { rerender } = render(<AtmosphereSettings />);

    expect(screen.getByText(/분 남음/)).toBeInTheDocument();

    vi.mocked(useAtmosphereStore).mockReturnValue({
      ...baseState,
      timerMinutes: null,
      timerEndAt: null,
    });

    rerender(<AtmosphereSettings />);

    expect(screen.queryByText(/분 남음/)).not.toBeInTheDocument();
  });
});
