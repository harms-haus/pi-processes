import { describe, expect, it } from "vitest";
import { formatLogTimestamp, formatTimestamp } from "../../ui/format-timestamp.js";

// ── Tests ───────────────────────────────────────────────────────────────────

describe("formatTimestamp", () => {
  it("formats zero milliseconds", () => {
    expect(formatTimestamp(0)).toBe("00:00:00.000");
  });

  it("formats milliseconds only", () => {
    expect(formatTimestamp(123)).toBe("00:00:00.123");
  });

  it("formats seconds only", () => {
    expect(formatTimestamp(5000)).toBe("00:00:05.000");
  });

  it("formats minutes and seconds", () => {
    expect(formatTimestamp(90000)).toBe("00:01:30.000");
  });

  it("formats hours, minutes, seconds, and millis", () => {
    expect(formatTimestamp(3723456)).toBe("01:02:03.456");
  });

  it("formats large values (24h+)", () => {
    expect(formatTimestamp(90061000)).toBe("25:01:01.000");
  });

  it("pads single-digit values", () => {
    expect(formatTimestamp(1001)).toBe("00:00:01.001");
  });
});

describe("formatLogTimestamp", () => {
  it("prepends plus sign to formatted timestamp", () => {
    expect(formatLogTimestamp(5000)).toBe("+00:00:05.000");
  });

  it("formats zero with plus sign", () => {
    expect(formatLogTimestamp(0)).toBe("+00:00:00.000");
  });
});
