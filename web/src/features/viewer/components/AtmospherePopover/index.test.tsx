import { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dialog role과 label을 제공하고 첫 포커스 가능한 요소로 포커스를 이동시킨다", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const triggerRef = createRef<HTMLButtonElement>();
    triggerRef.current = trigger;

    render(
      <AtmospherePopover
        onClose={vi.fn()}
        triggerRef={triggerRef}
      />,
    );

    expect(screen.getByRole("dialog", { name: "viewer.header.atmosphere_settings_dialog" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "First Control" })).toHaveFocus();
    });
  });

  it("언마운트 시 트리거 버튼으로 포커스를 복원한다", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const triggerRef = createRef<HTMLButtonElement>();
    triggerRef.current = trigger;

    const { unmount } = render(
      <AtmospherePopover
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
});
