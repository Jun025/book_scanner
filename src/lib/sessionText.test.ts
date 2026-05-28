import { describe, expect, it } from "vitest";
import { countSessionLines, toPlainSessionText } from "@/lib/sessionText";

describe("countSessionLines — 줄 개수", () => {
  it("빈 문자열은 0줄", () => {
    expect(countSessionLines("")).toBe(0);
  });

  it("한 줄짜리 바코드는 1", () => {
    expect(countSessionLines("9780000000001")).toBe(1);
  });

  it("여러 줄은 줄 개수만큼", () => {
    expect(countSessionLines("1\n2\n3")).toBe(3);
  });

  it("공백·빈 줄은 카운트에서 제외", () => {
    expect(countSessionLines("1\n\n2\n   \n3")).toBe(3);
  });

  it("마지막 trailing newline은 카운트하지 않는다", () => {
    expect(countSessionLines("1\n2\n")).toBe(2);
  });

  it("탭·공백만 있는 줄은 카운트에서 제외", () => {
    expect(countSessionLines("\t\n  \n1")).toBe(1);
  });
});

describe("toPlainSessionText — 클립보드용 정규화", () => {
  it("빈 문자열은 빈 문자열", () => {
    expect(toPlainSessionText("")).toBe("");
  });

  it("앞뒤 공백을 trim한다", () => {
    expect(toPlainSessionText("  1234  ")).toBe("1234");
  });

  it("빈 줄·공백 줄을 제거한다", () => {
    expect(toPlainSessionText("1\n\n2\n   \n3")).toBe("1\n2\n3");
  });

  it("줄 사이 단일 \\n으로 직렬화한다(잉여 공백 정리)", () => {
    expect(toPlainSessionText("1\n  2 \n3")).toBe("1\n2\n3");
  });

  it("바코드 사이 trailing newline 제거", () => {
    expect(toPlainSessionText("1\n2\n\n\n")).toBe("1\n2");
  });
});
