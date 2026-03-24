import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChapterListModal } from "./index";
import styles from "./ChapterListModal.module.css";

const getVolumesMock = vi.fn();
const getChaptersMock = vi.fn();

vi.mock("../../../../api/client", () => ({
  seriesAPI: {
    getVolumes: (...args: unknown[]) => getVolumesMock(...args),
    getChapters: (...args: unknown[]) => getChaptersMock(...args),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string; [key: string]: unknown }) => options?.defaultValue ?? _key,
  }),
}));

describe("ChapterListModal", () => {
  beforeEach(() => {
    getVolumesMock.mockReset();
    getChaptersMock.mockReset();
  });

  it("dialog role을 제공하고 열릴 때 닫기 버튼으로 포커스를 이동한다", async () => {
    getVolumesMock.mockResolvedValue({ data: { volumes: [] } });
    getChaptersMock.mockResolvedValue({ data: { chapters: [] } });

    render(
      <ChapterListModal
        seriesId="series-1"
        isOpen
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "시리즈 목록" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("common.close")).toHaveFocus();
  });

  it("ESC와 오버레이 클릭으로 닫힌다", async () => {
    const onClose = vi.fn();
    getVolumesMock.mockResolvedValue({ data: { volumes: [] } });
    getChaptersMock.mockResolvedValue({ data: { chapters: [] } });

    const { container } = render(
      <ChapterListModal
        seriesId="series-1"
        isOpen
        onClose={onClose}
        onNavigate={vi.fn()}
      />,
    );

    await screen.findByRole("dialog", { name: "시리즈 목록" });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const overlay = container.firstElementChild;
    expect(overlay).toBeTruthy();
    if (overlay) {
      fireEvent.click(overlay);
    }
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("현재 챕터가 속한 볼륨 체인을 자동 확장하고, 토글로 접고 다시 펼칠 수 있다", async () => {
    getVolumesMock.mockResolvedValue({
      data: {
        volumes: [
          { id: "v1", title: "1권", parent_id: undefined },
          { id: "v1-1", title: "1권 외전", parent_id: "v1" },
        ],
      },
    });
    getChaptersMock.mockResolvedValue({
      data: {
        chapters: [
          { id: "c1", title: "1화", volume_id: "v1" },
          { id: "c2", title: "외전 1화", volume_id: "v1-1" },
        ],
      },
    });

    render(
      <ChapterListModal
        seriesId="series-1"
        currentChapterId="c2"
        isOpen
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    const parentButton = await screen.findByRole("button", { name: /1권$/i });
    const expandedButton = await screen.findByRole("button", { name: /1권 외전/i });
    expect(parentButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^1화$/i })).toBeInTheDocument();
    expect(expandedButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^외전 1화$/i })).toHaveClass(styles.activeChapter);

    fireEvent.click(parentButton);

    await waitFor(() => {
      expect(parentButton).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("button", { name: /^1화$/i })).not.toBeInTheDocument();
    });

    fireEvent.click(parentButton);

    await waitFor(() => {
      expect(parentButton).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: /^1화$/i })).toBeInTheDocument();
    });
  });

  it("챕터 항목 클릭 시 onNavigate를 호출한다", async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    getVolumesMock.mockResolvedValue({ data: { volumes: [{ id: "v1", title: "1권", parent_id: undefined }] } });
    getChaptersMock.mockResolvedValue({ data: { chapters: [{ id: "c1", title: "1화", volume_id: "v1" }] } });

    render(
      <ChapterListModal
        seriesId="series-1"
        isOpen
        onClose={onClose}
        onNavigate={onNavigate}
      />,
    );

    const volumeButton = await screen.findByRole("button", { name: /1권/i });
    fireEvent.click(volumeButton);

    const chapterButton = await screen.findByRole("button", { name: /1화/i });
    fireEvent.click(chapterButton);

    expect(onNavigate).toHaveBeenCalledWith("c1");
    expect(onClose).toHaveBeenCalled();
  });
});
