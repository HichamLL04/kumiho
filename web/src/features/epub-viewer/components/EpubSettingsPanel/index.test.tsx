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

  it("페이지 모드 버튼에서 1페이지와 2페이지를 선택하면 paginated spread를 변경한다", () => {
    const onFlowChange = vi.fn();
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
        onFlowChange={onFlowChange}
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
    expect(onFlowChange).not.toHaveBeenCalled();
  });

  it("세로 스크롤에서 1페이지를 선택하면 paginated flow로 전환하고 spread를 변경한다", () => {
    const onFlowChange = vi.fn();
    const onSpreadChange = vi.fn();
    render(
      <EpubSettingsPanel
        settings={{
          fontSize: 100,
          fontFamily: "sans-serif",
          lineHeight: 1.5,
          theme: "light",
          renderMode: "auto",
          flow: "scrolled",
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
        onSpreadChange={onSpreadChange}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("epub_viewer.footer.pages_1"));
    expect(onFlowChange).toHaveBeenCalledWith("paginated");
    expect(onSpreadChange).toHaveBeenCalledWith("none");
  });

  it("세로 스크롤 버튼 클릭 시 onFlowChange를 scrolled로 호출한다", () => {
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
  });
});
