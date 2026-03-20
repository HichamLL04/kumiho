import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { VolumePage } from "./Volume";

const { mocks } = vi.hoisted(() => {
  const navigateMock = vi.fn();
  const apiGetMock = vi.fn();
  const volumeGetChaptersMock = vi.fn();
  const volumeFindFirstChapterRecursivelyMock = vi.fn();
  const bootstrapAndPlayMock = vi.fn();

  return {
    mocks: {
      navigateMock,
      apiGetMock,
      volumeGetChaptersMock,
      volumeFindFirstChapterRecursivelyMock,
      bootstrapAndPlayMock,
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigateMock,
    useLocation: () => ({ pathname: "/volumes/volume-1", search: "" }),
  };
});

vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => mocks.apiGetMock(...args),
  },
  volumeAPI: {
    getChapters: (...args: unknown[]) => mocks.volumeGetChaptersMock(...args),
    findFirstChapterRecursively: (...args: unknown[]) => mocks.volumeFindFirstChapterRecursivelyMock(...args),
    markComplete: vi.fn(),
    deleteCompletion: vi.fn(),
  },
  downloadAPI: {
    getVolumeUrl: vi.fn(),
  },
  chapterAPI: {
    deleteProgress: vi.fn(),
    markComplete: vi.fn(),
    markPreviousComplete: vi.fn(),
  },
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({ role: "MASTER" }),
}));

vi.mock("../stores/audioPlayerStore", () => ({
  useAudioPlayerStore: {
    getState: () => ({
      bootstrapAndPlay: mocks.bootstrapAndPlayMock,
    }),
  },
}));

vi.mock("../components/headers/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("../components/headers/SubHeader", () => ({
  SubHeader: () => <div data-testid="sub-header" />,
}));

vi.mock("../components/Sidebar", () => ({
  Sidebar: () => null,
}));

vi.mock("../components/SeriesCard", () => ({
  SeriesCard: () => <div data-testid="series-card" />,
}));

vi.mock("../components/SeriesInfoCard", () => ({
  SeriesInfoCard: ({ onPlay }: { onPlay: () => void | Promise<void> }) => (
    <button
      type="button"
      data-testid="volume-info-play"
      onClick={() => void onPlay()}
    >
      play
    </button>
  ),
}));

vi.mock("../components/modals/AlertModal", () => ({
  AlertModal: () => null,
}));

vi.mock("../components/common/LoadingSpinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

vi.mock("../components/common/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

describe("VolumePage audiobook bootstrap guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bootstrapAndPlayMock.mockResolvedValue({ ok: true });
    mocks.volumeGetChaptersMock.mockResolvedValue({
      data: {
        chapters: [
          {
            id: "chapter-3",
            volume_id: "volume-1",
            title: "챕터 3",
            chapter_number: 3,
            path: "/books/chapter-3.zip",
            page_count: 10,
            created_at: "2026-03-21T00:00:00Z",
            updated_at: "2026-03-21T00:00:00Z",
          },
        ],
      },
    });
    mocks.volumeFindFirstChapterRecursivelyMock.mockResolvedValue(null);
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/volumes/volume-1"]}>
        <Routes>
          <Route
            path="/volumes/:volumeId"
            element={<VolumePage />}
          />
        </Routes>
      </MemoryRouter>,
    );

  it("일반 도서 볼륨은 has_audio=true 여도 기존 뷰어 진입을 사용한다", async () => {
    mocks.apiGetMock.mockImplementation((url: string) => {
      if (url === "/volumes/volume-1") {
        return Promise.resolve({
          data: {
            id: "volume-1",
            series_id: "series-1",
            title: "볼륨 1",
            volume_number: 1,
            path: "/books/volume-1.zip",
            has_audio: true,
            library_type: "book",
            created_at: "2026-03-21T00:00:00Z",
          },
        });
      }
      if (url === "/series/series-1/volumes?parent_id=volume-1") {
        return Promise.resolve({ data: { volumes: [] } });
      }
      if (url === "/series/series-1") {
        return Promise.resolve({
          data: {
            id: "series-1",
            library_id: "library-1",
            title: "일반 도서",
            path: "/books/series",
            library_type: "book",
            has_audio: true,
            created_at: "2026-03-21T00:00:00Z",
            updated_at: "2026-03-21T00:00:00Z",
          },
        });
      }
      if (url === "/volumes/volume-1/progress") {
        return Promise.resolve({
          data: {
            progress_list: [
              {
                chapter_id: "chapter-3",
                updated_at: "2026-03-21T00:00:00Z",
              },
            ],
          },
        });
      }
      throw new Error(`Unhandled api.get(${url})`);
    });

    renderPage();

    fireEvent.click(await screen.findByTestId("volume-info-play"));

    await waitFor(() => {
      expect(mocks.navigateMock).toHaveBeenCalledWith("/viewer/chapter-3", {
        state: { from: "/volumes/volume-1" },
      });
    });
    expect(mocks.bootstrapAndPlayMock).not.toHaveBeenCalled();
  });

  it("오디오북 볼륨은 오디오 부트스트랩을 호출한다", async () => {
    mocks.apiGetMock.mockImplementation((url: string) => {
      if (url === "/volumes/volume-1") {
        return Promise.resolve({
          data: {
            id: "volume-1",
            series_id: "series-1",
            title: "오디오 볼륨",
            volume_number: 1,
            path: "/audio/volume-1",
            has_audio: true,
            library_type: "audiobook",
            created_at: "2026-03-21T00:00:00Z",
          },
        });
      }
      if (url === "/series/series-1/volumes?parent_id=volume-1") {
        return Promise.resolve({ data: { volumes: [] } });
      }
      if (url === "/series/series-1") {
        return Promise.resolve({
          data: {
            id: "series-1",
            library_id: "library-1",
            title: "오디오북",
            path: "/audio/series",
            library_type: "audiobook",
            has_audio: true,
            created_at: "2026-03-21T00:00:00Z",
            updated_at: "2026-03-21T00:00:00Z",
          },
        });
      }
      if (url === "/volumes/volume-1/progress") {
        return Promise.resolve({ data: { progress_list: [] } });
      }
      throw new Error(`Unhandled api.get(${url})`);
    });

    renderPage();

    fireEvent.click(await screen.findByTestId("volume-info-play"));

    await waitFor(() => {
      expect(mocks.bootstrapAndPlayMock).toHaveBeenCalledWith({
        source: "volume",
        seriesId: "series-1",
        volumeId: "volume-1",
        series: expect.objectContaining({
          id: "series-1",
          library_type: "audiobook",
        }),
        volume: expect.objectContaining({
          id: "volume-1",
        }),
      });
    });
  });
});
