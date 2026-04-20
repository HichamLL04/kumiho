import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { EpubSettingsPanel } from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("EpubSettingsPanel", () => {
  it("닫기 X 버튼이 존재하고 클릭 시 onClose를 호출한다", () => {
    const onClose = vi.fn();
    render(
      <EpubSettingsPanel
        settings={{
          fontSize: 100,
          fontFamily: "sans-serif",
          lineHeight: 1.5,
          theme: "light",
          renderMode: "auto",
          flow: "paginated",
          spread: "auto",
          wheelDirection: "down",
          keyboardDirection: "right",
          clickDirection: "right",
        }}
        onFontSizeChange={vi.fn()}
        onFontFamilyChange={vi.fn()}
        onLineHeightChange={vi.fn()}
        onThemeChange={vi.fn()}
        onRenderModeChange={vi.fn()}
        onFlowChange={vi.fn()}
        onWheelDirectionChange={vi.fn()}
        onKeyboardDirectionChange={vi.fn()}
        onClickDirectionChange={vi.fn()}
        onSpreadChange={vi.fn()}
        onClose={onClose}
      />,
    );

    const closeButton = screen.getByLabelText("common.close");
    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("페이지 모드(Spread) 버튼 클릭 시 onSpreadChange를 올바른 인자로 호출한다", () => {
    const onSpreadChange = vi.fn();
    render(
      <EpubSettingsPanel
        settings={{
          fontSize: 100,
          fontFamily: "sans-serif",
          lineHeight: 1.5,
          theme: "light",
          renderMode: "auto",
          flow: "paginated",
          spread: "auto",
          wheelDirection: "down",
          keyboardDirection: "right",
          clickDirection: "right",
        }}
        onFontSizeChange={vi.fn()}
        onFontFamilyChange={vi.fn()}
        onLineHeightChange={vi.fn()}
        onThemeChange={vi.fn()}
        onRenderModeChange={vi.fn()}
        onFlowChange={vi.fn()}
        onWheelDirectionChange={vi.fn()}
        onKeyboardDirectionChange={vi.fn()}
        onClickDirectionChange={vi.fn()}
        onSpreadChange={onSpreadChange}
        onClose={vi.fn()}
      />,
    );

    const btn1Page = screen.getByText("epub_viewer.footer.pages_1");
    const btn2Page = screen.getByText("epub_viewer.footer.pages_2");

    fireEvent.click(btn1Page);
    expect(onSpreadChange).toHaveBeenCalledWith("none");

    fireEvent.click(btn2Page);
    expect(onSpreadChange).toHaveBeenCalledWith("auto");
  });

  it("레이아웃 버튼 클릭 시 onFlowChange를 올바른 인자로 호출한다", () => {
    const onFlowChange = vi.fn();
    render(
      <EpubSettingsPanel
        settings={{
          fontSize: 100,
          fontFamily: "sans-serif",
          lineHeight: 1.5,
          theme: "light",
          renderMode: "auto",
          flow: "paginated",
          spread: "auto",
          wheelDirection: "down",
          keyboardDirection: "right",
          clickDirection: "right",
        }}
        onFontSizeChange={vi.fn()}
        onFontFamilyChange={vi.fn()}
        onLineHeightChange={vi.fn()}
        onThemeChange={vi.fn()}
        onRenderModeChange={vi.fn()}
        onFlowChange={onFlowChange}
        onWheelDirectionChange={vi.fn()}
        onKeyboardDirectionChange={vi.fn()}
        onClickDirectionChange={vi.fn()}
        onSpreadChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("epub_viewer.settings.flow.scrolled"));
    expect(onFlowChange).toHaveBeenCalledWith("scrolled");

    fireEvent.click(screen.getByText("epub_viewer.settings.flow.paginated"));
    expect(onFlowChange).toHaveBeenCalledWith("paginated");
  });
});
