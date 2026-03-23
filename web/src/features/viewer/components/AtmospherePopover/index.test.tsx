import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtmospherePopover } from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../../components/Atmosphere/AtmosphereSettings", () => ({
  AtmosphereSettings: () => <button type="button">First Control</button>,
}));

describe("AtmospherePopover", () => {
  const appendedTriggers: HTMLButtonElement[] = [];

  afterEach(() => {
    appendedTriggers.forEach((trigger) => trigger.remove());
    appendedTriggers.length = 0;
  });

  it("dialog role과 label을 제공하고 첫 포커스 가능한 요소로 포커스를 이동시킨다", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    appendedTriggers.push(trigger);
    const triggerRef = createRef<HTMLButtonElement>();
    triggerRef.current = trigger;

    render(
      <AtmospherePopover
        id="atmosphere-popover"
        onClose={vi.fn()}
        triggerRef={triggerRef}
      />,
    );

    expect(screen.getByRole("dialog", { name: "viewer.header.atmosphere_settings_dialog" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "viewer.header.atmosphere_settings_dialog" })).toHaveAttribute("id", "atmosphere-popover");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "First Control" })).toHaveFocus();
    });
  });

  it("언마운트 시 트리거 버튼으로 포커스를 복원한다", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    appendedTriggers.push(trigger);
    const triggerRef = createRef<HTMLButtonElement>();
    triggerRef.current = trigger;

    const { unmount } = render(
      <AtmospherePopover
        id="atmosphere-popover"
        onClose={vi.fn()}
        triggerRef={triggerRef}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "First Control" })).toHaveFocus();
    });

    unmount();

    expect(trigger).toHaveFocus();
  });

  it("트리거 버튼 클릭은 외부 클릭으로 처리하지 않는다", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    appendedTriggers.push(trigger);
    const triggerRef = createRef<HTMLButtonElement>();
    triggerRef.current = trigger;
    const onClose = vi.fn();

    render(
      <AtmospherePopover
        id="atmosphere-popover"
        onClose={onClose}
        triggerRef={triggerRef}
      />,
    );

    fireEvent.mouseDown(trigger);

    expect(onClose).not.toHaveBeenCalled();
  });
});
