import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ViewerHeader } from "./index";
import { useAtmosphereStore } from "../../../../stores/atmosphereStore";

// Mocks
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../../stores/atmosphereStore", () => ({
  useAtmosphereStore: vi.fn(),
}));

vi.mock("zustand/react/shallow", () => ({
  useShallow: (fn: any) => fn,
}));

vi.mock("../AtmospherePopover", () => ({
  AtmospherePopover: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="atmosphere-popover">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

describe("ViewerHeader Atmosphere Toggle", () => {
  const mockSetEnabled = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderHeader(isEnabled = false) {
    (useAtmosphereStore as any).mockReturnValue({
      isEnabled,
      setEnabled: mockSetEnabled,
    });

    const props: any = {
      state: { title: "Test Book" },
      actions: {},
      onInteractionStart: vi.fn(),
      onInteractionEnd: vi.fn(),
    };

    return render(<ViewerHeader {...props} />);
  }

  it("분위기 음이 꺼져 있을 때 버튼 클릭 시 팝오버 오픈", () => {
    renderHeader(false);

    const toggleBtn = screen.getByLabelText("viewer.header.atmosphere_on");
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId("atmosphere-popover")).toBeInTheDocument();
  });

  it("분위기 음이 켜져 있을 때 버튼 클릭 시 즉시 종료", () => {
    renderHeader(true);

    const toggleBtn = screen.getByLabelText("viewer.header.atmosphere_off");
    fireEvent.click(toggleBtn);

    expect(mockSetEnabled).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId("atmosphere-popover")).not.toBeInTheDocument();
  });

  it("팝오버가 열린 상태에서 다시 버튼을 누르면 팝오버 닫힘 (OFF 상태)", () => {
    renderHeader(false);

    const toggleBtn = screen.getByLabelText("viewer.header.atmosphere_on");

    // 열기
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("atmosphere-popover")).toBeInTheDocument();

    // 다시 눌러서 닫기
    fireEvent.click(toggleBtn);
    expect(screen.queryByTestId("atmosphere-popover")).not.toBeInTheDocument();
  });
});
