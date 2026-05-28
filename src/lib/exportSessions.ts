import { countSessionLines, toPlainSessionText } from "@/lib/sessionText";
import { readSessionRaw, SESSION_STORAGE_PREFIX } from "@/store/useScannerStore";

export type ExportResult =
  | "shared"
  | "copied"
  | "downloaded"
  | "cancelled"
  | "empty"
  | "failed";

/** 세션 키(`book-scanner:session:` + ISO8601)를 학생이 알아보기 쉬운 사람 라벨로 변환. */
function formatSessionLabelFor(key: string, now: Date): string {
  const iso = key.slice(SESSION_STORAGE_PREFIX.length);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return key;

  const time = d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (today.getTime() - target.getTime()) / 86_400_000
  );

  if (dayDiff === 0) return `오늘 ${time}`;
  if (dayDiff === 1) return `어제 ${time}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${time}`;
  }
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${time}`;
}

/**
 * 저장된 모든 세션을 사람이 읽을 수 있는 텍스트 한 덩어리로 직렬화한다.
 * 세션 사이는 구분선과 빈 줄로 분리해 메신저·메일에 그대로 붙여 넣어도
 * 읽기 좋게 만든다. 빈 세션(0줄)은 출력에서 제외한다(이미 메인 정리로
 * 사라지지만 방어적으로 한 번 더).
 */
export function buildAllSessionsText(
  keys: string[],
  now: Date = new Date()
): string {
  if (keys.length === 0) return "";

  const sessions: { label: string; count: number; body: string }[] = [];
  let totalBooks = 0;
  for (const key of keys) {
    const raw = readSessionRaw(key);
    const count = countSessionLines(raw);
    if (count === 0) continue;
    sessions.push({
      label: formatSessionLabelFor(key, now),
      count,
      body: toPlainSessionText(raw),
    });
    totalBooks += count;
  }

  if (sessions.length === 0) return "";

  const stamp = now.toLocaleString("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const lines: string[] = [];
  lines.push("빛나래 장서점검 전체 기록");
  lines.push(`내보낸 시각: ${stamp}`);
  lines.push(`총 ${sessions.length}개 점검 · 합계 ${totalBooks}권`);
  lines.push("");

  const divider = "────────────────────";
  for (const s of sessions) {
    lines.push(divider);
    lines.push(`${s.label} · ${s.count}권`);
    lines.push(s.body);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function buildExportFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}`;
  return `빛나래장서점검_전체기록_${stamp}.txt`;
}

/**
 * 1) Web Share API → 2) 클립보드 → 3) .txt 파일 다운로드 순으로 폴백.
 * 사용자가 share 시트에서 취소한 경우는 cancelled로 명시 — 토스트로 안내
 * 하지 말 것.
 */
export async function shareOrCopyOrDownload(
  text: string,
  filename: string
): Promise<ExportResult> {
  if (!text) return "empty";

  /* 1) Web Share API */
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "빛나래 장서점검 전체 기록",
        text,
      });
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
      /* 그 외 오류는 다음 폴백으로 흘려보낸다 */
    }
  }

  /* 2) 클립보드 */
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      /* 폴백 계속 */
    }
  }

  /* 3) .txt 파일 다운로드 (PWA·iOS Safari 일부는 download 속성을 무시할 수
     있으나 모바일 Chrome/Edge·데스크톱 전반에서 동작) */
  if (typeof document !== "undefined" && typeof URL !== "undefined") {
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return "downloaded";
    } catch {
      return "failed";
    }
  }

  return "failed";
}
