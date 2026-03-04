import { afterEach, describe, expect, it, vi } from "vitest";
import { isOldIOSSafari } from "./browserDetect";

const IOS_15_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 Version/15.6 Mobile/15E148 Safari/604.1";
const IOS_16_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 Version/16.6 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36";

function stubNavigator(userAgent: string, platform: string, maxTouchPoints: number) {
  vi.stubGlobal("navigator", {
    userAgent,
    platform,
    maxTouchPoints,
  });
}

describe("isOldIOSSafari", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true for iOS 15 user agent", () => {
    stubNavigator(IOS_15_UA, "iPhone", 0);

    expect(isOldIOSSafari()).toBe(true);
  });

  it("returns false for iOS 16 user agent", () => {
    stubNavigator(IOS_16_UA, "iPhone", 0);

    expect(isOldIOSSafari()).toBe(false);
  });

  it("returns false for Android Chrome user agent", () => {
    stubNavigator(ANDROID_CHROME_UA, "Linux armv8l", 0);

    expect(isOldIOSSafari()).toBe(false);
  });

  it("returns true for iPad desktop mode when version cannot be parsed", () => {
    stubNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "MacIntel",
      5,
    );

    expect(isOldIOSSafari()).toBe(true);
  });

  it("returns false when navigator is unavailable", () => {
    vi.stubGlobal("navigator", undefined);

    expect(isOldIOSSafari()).toBe(false);
  });
});
