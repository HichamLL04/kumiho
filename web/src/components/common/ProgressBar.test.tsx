import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("max가 0 이하이면 진행률과 aria 값을 0으로 고정한다", () => {
    const { rerender } = render(<ProgressBar value={40} max={0} ariaLabel="scan progress" />);

    let progressbar = screen.getByRole("progressbar", { name: "scan progress" });
    expect(progressbar).toHaveAttribute("aria-valuemax", "100");
    expect(progressbar).toHaveAttribute("aria-valuenow", "0");
    expect(progressbar.firstElementChild).toHaveStyle({ width: "0%" });

    rerender(<ProgressBar value={40} max={-10} ariaLabel="scan progress" />);

    progressbar = screen.getByRole("progressbar", { name: "scan progress" });
    expect(progressbar).toHaveAttribute("aria-valuemax", "100");
    expect(progressbar).toHaveAttribute("aria-valuenow", "0");
    expect(progressbar.firstElementChild).toHaveStyle({ width: "0%" });
  });

  it("aria-labelledby로도 접근 가능한 이름을 제공한다", () => {
    render(
      <>
        <span id="scan-progress-label">메타데이터 스캔 진행률</span>
        <ProgressBar value={25} ariaLabelledBy="scan-progress-label" />
      </>,
    );

    expect(screen.getByRole("progressbar", { name: "메타데이터 스캔 진행률" })).toBeInTheDocument();
  });

  it("ariaLabel 또는 ariaLabelledBy 중 하나는 반드시 필요하다", () => {
    expectTypeCheck();
  });
});

function expectTypeCheck() {
  // @ts-expect-error ariaLabel 또는 ariaLabelledBy 중 하나는 필수
  const invalidUsage = <ProgressBar value={10} />;

  expect(invalidUsage).toBeDefined();
}
