"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import AppHeader from "@/components/AppHeader";
import OnlineStatusBanner from "@/components/OnlineStatusBanner";
import { useScanBeeps } from "@/hooks/useScanBeeps";
import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import { countSessionLines } from "@/lib/sessionText";
import { useScannerStore } from "@/store/useScannerStore";

/** 도서관·상품 공통: 숫자만, 5~13자리 */
const VALID_BARCODE = /^\d{5,13}$/;

/** 카메라가 같은 프레임에서 비숫자를 연속 디코딩할 때 비프·토스트 스팸 방지 */
const INVALID_BEEP_COOLDOWN_MS = 900;
/** 중복 토스트가 너무 자주 갱신되어 가려지지 않도록 짧게 누른다 */
const DUPLICATE_TOAST_COOLDOWN_MS = 1200;
const SCAN_INTERVAL_MS = 100;
const SUCCESS_VIBRATION_PATTERN: number | number[] = [70];
const UNSUPPORTED_MESSAGE =
  "이 브라우저는 바코드 스캔을 지원하지 않아요. Safari 17 이상이나 최신 Chrome으로 다시 들어와 주세요.";
const CAMERA_ERROR_TITLE = "카메라를 켤 수 없어요";
const CAMERA_ERROR_HINT =
  "설정에서 카메라 사용을 허용한 뒤 이 화면으로 돌아오면 다시 연결할게요.";
/** 도서관 등 조용한 환경을 위해 비프만 끄는 설정. 진동/시각 피드백은 유지. */
const SOUND_MUTED_STORAGE_KEY = "book-scanner:settings:sound-muted";
const BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
] as const;

type DetectedBarcodeLike = { rawValue?: string | null };
type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcodeLike[]>;
};
type BarcodeDetectorLikeConstructor = {
  new (options?: {
    formats?: string[];
  }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};
type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: BarcodeDetectorLikeConstructor;
};

/** iOS/Android 등에서 확장되는 비디오 트랙 capability (lib.dom 미반영 필드) */
type VideoTrackCapabilities = MediaTrackCapabilities & {
  zoom?: { min?: number; max?: number; step?: number };
  focusMode?: string[];
};

async function applyVideoTrackScanOptimizations(track: MediaStreamTrack) {
  const getCaps = track.getCapabilities?.bind(track);
  if (typeof getCaps !== "function") return;

  let caps: VideoTrackCapabilities;
  try {
    caps = getCaps() as VideoTrackCapabilities;
  } catch {
    return;
  }

  let zoom: number | undefined;
  const z = caps.zoom;
  if (z && typeof z === "object") {
    const devLo = z.min ?? 1;
    const devHi = z.max ?? 1;
    const bandLo = Math.max(1.5, devLo);
    const bandHi = Math.min(2.0, devHi);
    if (bandLo <= bandHi) {
      zoom = bandHi;
    }
  }

  const focusContinuous =
    Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous");

  const advanced: Record<string, unknown> = {};
  if (zoom !== undefined) advanced.zoom = zoom;
  if (focusContinuous) advanced.focusMode = "continuous";

  if (Object.keys(advanced).length === 0) return;

  try {
    await track.applyConstraints({
      advanced: [advanced as MediaTrackConstraintSet],
    });
  } catch {
    /* iOS Safari 등: 미지원 시 카메라는 그대로 사용 */
  }
}
type ClientInfo = {
  browser: string;
  os: string;
};
type QuaggaResultLike = {
  codeResult?: {
    code?: string | null;
  } | null;
} | null;
type QuaggaLike = {
  decodeSingle: (
    config: Record<string, unknown>,
    callback?: (result: QuaggaResultLike) => void
  ) => Promise<QuaggaResultLike>;
  stop?: () => void;
};

type ScannerProps = {
  onExitSession?: () => void;
};

export default function Scanner({ onExitSession }: ScannerProps) {
  const activeSessionKey = useScannerStore((s) => s.activeSessionKey);
  const endInventorySession = useScannerStore((s) => s.endInventorySession);
  const liveSessionText = useScannerStore((s) => s.liveSessionText);
  const setLiveSessionText = useScannerStore((s) => s.setLiveSessionText);
  const appendDigitScanToActiveSession = useScannerStore(
    (s) => s.appendDigitScanToActiveSession
  );
  const lastCapturedCode = useScannerStore((s) => s.lastCapturedCode);
  const lastCaptureAt = useScannerStore((s) => s.lastCaptureAt);

  const sessionTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const quaggaRef = useRef<QuaggaLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const detectBusyRef = useRef(false);
  const lastInvalidBeepAt = useRef(0);
  const lastDuplicateToastAt = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const activeEngineRef = useRef<"native" | "quagga" | null>(null);
  const scanBufferRef = useRef<string[]>([]);
  const hasVibrationSupportRef = useRef(false);
  const debugDialogRef = useRef<HTMLDivElement | null>(null);
  const debugTriggerRef = useRef<HTMLButtonElement | null>(null);

  const { playSuccess, playFailure, prime } = useScanBeeps();

  const [mode, setMode] = useState<"idle" | "loading" | "camera" | "mock">(
    "idle"
  );
  const [mockTitle, setMockTitle] = useState(CAMERA_ERROR_TITLE);
  const [mockMessage, setMockMessage] = useState(CAMERA_ERROR_HINT);
  const [clientInfo, setClientInfo] = useState<ClientInfo>({
    browser: "확인 중...",
    os: "확인 중...",
  });
  const [vibrationSupportLabel, setVibrationSupportLabel] =
    useState("확인 중...");
  const [detectorEngine, setDetectorEngine] = useState("초기화 전");
  const [flashKey, setFlashKey] = useState<number | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "info"; text: string } | null>(null);
  const [cameraRetryToken, setCameraRetryToken] = useState(0);
  const [debugInfoOpen, setDebugInfoOpen] = useState(false);
  const [sessionEditMode, setSessionEditMode] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setSoundMuted(window.localStorage.getItem(SOUND_MUTED_STORAGE_KEY) === "1");
    } catch {
      /* private mode 등 — 기본값 유지 */
    }
  }, []);

  const toggleSoundMuted = useCallback(() => {
    setSoundMuted((prev) => {
      const next = !prev;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(SOUND_MUTED_STORAGE_KEY, next ? "1" : "0");
        }
      } catch {
        /* 저장 실패해도 런타임 상태는 토글된다 */
      }
      return next;
    });
  }, []);

  const inSession = activeSessionKey !== null;
  const totalBooks = countSessionLines(liveSessionText);

  /** 카메라가 실제로 동작 중일 때만 화면 꺼짐 방지(서가에서 장시간 스캔 마찰 해소) */
  useScreenWakeLock(inSession && mode === "camera");

  useEffect(() => {
    if (!inSession) setSessionEditMode(false);
  }, [inSession]);

  useLayoutEffect(() => {
    if (!inSession || sessionEditMode) return;
    const el = sessionTextareaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [inSession, liveSessionText, sessionEditMode]);

  const enterSessionEditMode = useCallback(() => {
    setSessionEditMode(true);
    requestAnimationFrame(() => {
      const el = sessionTextareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }, []);

  const exitSessionEditMode = useCallback(() => {
    setSessionEditMode(false);
    sessionTextareaRef.current?.blur();
  }, []);

  useEffect(() => {
    if (!inSession) return;
    prime();
  }, [inSession, prime]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent;

    const browser = (() => {
      const edge = ua.match(/Edg\/([\d.]+)/);
      if (edge) return `Edge ${edge[1]}`;
      const crios = ua.match(/CriOS\/([\d.]+)/);
      if (crios) return `Chrome ${crios[1]}`;
      const chrome = ua.match(/Chrome\/([\d.]+)/);
      if (chrome) return `Chrome ${chrome[1]}`;
      const firefox = ua.match(/FxiOS\/([\d.]+)|Firefox\/([\d.]+)/);
      if (firefox) return `Firefox ${firefox[1] ?? firefox[2]}`;
      const safari = ua.match(/Version\/([\d.]+).*Safari/);
      if (safari) return `Safari ${safari[1]}`;
      return "알 수 없는 브라우저";
    })();

    const os = (() => {
      const ios = ua.match(/OS (\d+[_\d]*) like Mac OS X/);
      if (ios) return `iOS ${ios[1].replaceAll("_", ".")}`;
      const android = ua.match(/Android ([\d.]+)/);
      if (android) return `Android ${android[1]}`;
      const mac = ua.match(/Mac OS X ([\d_]+)/);
      if (mac) return `macOS ${mac[1].replaceAll("_", ".")}`;
      const windows = ua.match(/Windows NT ([\d.]+)/);
      if (windows) return `Windows NT ${windows[1]}`;
      return navigator.platform || "알 수 없는 OS";
    })();

    setClientInfo({ browser, os });
    const supportsVibration = typeof navigator.vibrate === "function";
    hasVibrationSupportRef.current = supportsVibration;
    setVibrationSupportLabel(supportsVibration ? "지원" : "미지원");
  }, []);

  /* 다이얼로그 ARIA APG 패턴: ESC 닫기, Tab 트랩, 닫을 때 트리거로 포커스 복귀. */
  useEffect(() => {
    if (!debugInfoOpen) return;

    const dialog = debugDialogRef.current;
    /* 닫을 때 포커스를 돌려놓을 트리거를 effect 시점에 캡처해 두면
       cleanup 시 ref가 바뀌어도 동일 노드를 가리킬 수 있어요. */
    const trigger = debugTriggerRef.current;

    /* 다이얼로그 열 때 첫 포커스를 다이얼로그 안 첫 인터랙티브 요소로. */
    const focusables = () =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => !el.hasAttribute("disabled"))
        : [];

    const initial = focusables();
    initial[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDebugInfoOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !dialog?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [debugInfoOpen]);

  const vibrateOnSuccess = useCallback(() => {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
      return false;
    }
    try {
      const didVibrate = navigator.vibrate(SUCCESS_VIBRATION_PATTERN);
      hasVibrationSupportRef.current = didVibrate;
      return didVibrate;
    } catch {
      /* 지원하지 않는 환경에서는 조용히 무시 */
      hasVibrationSupportRef.current = false;
      return false;
    }
  }, []);

  const showToast = useCallback(
    (text: string, tone: "success" | "info", durationMs: number) => {
      setToast({ tone, text });
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, durationMs);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  const maybePlaySuccess = useCallback(() => {
    if (soundMuted) return;
    playSuccess();
  }, [playSuccess, soundMuted]);

  const maybePlayFailure = useCallback(() => {
    if (soundMuted) return;
    playFailure();
  }, [playFailure, soundMuted]);

  const triggerFeedback = useCallback(
    (digits: string) => {
      maybePlaySuccess();
      void vibrateOnSuccess();
      setFlashKey(Date.now());
      showToast(`기록했어요 · ${digits}`, "success", 1500);
    },
    [maybePlaySuccess, showToast, vibrateOnSuccess]
  );

  const handleDecoded = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!VALID_BARCODE.test(trimmed)) {
        const now = Date.now();
        if (now - lastInvalidBeepAt.current >= INVALID_BEEP_COOLDOWN_MS) {
          lastInvalidBeepAt.current = now;
          maybePlayFailure();
          showToast("숫자가 아니라 넘어갔어요", "info", 1400);
        }
        return;
      }
      const ok = appendDigitScanToActiveSession(trimmed);
      if (ok) {
        triggerFeedback(trimmed);
        return;
      }
      /* 쿨다운 안에 같은 코드가 또 인식된 경우 — 사용자에게 "이미 찍었다"는 점을 부드럽게 알린다 */
      const now = Date.now();
      if (now - lastDuplicateToastAt.current >= DUPLICATE_TOAST_COOLDOWN_MS) {
        lastDuplicateToastAt.current = now;
        showToast(`방금 찍은 번호예요 · ${trimmed}`, "info", 1400);
      }
    },
    [appendDigitScanToActiveSession, maybePlayFailure, showToast, triggerFeedback]
  );

  const retryCamera = useCallback(() => {
    setCameraRetryToken((prev) => prev + 1);
  }, []);

  const clearScanTimer = useCallback(() => {
    if (scanTimerRef.current === null) return;
    window.clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
  }, []);

  const stopCameraStream = useCallback(() => {
    const directVideo = videoRef.current;
    const srcObject =
      directVideo?.srcObject instanceof MediaStream ? directVideo.srcObject : null;
    const stream = srcObject ?? streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (directVideo) {
      directVideo.srcObject = null;
    }
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!inSession || mode !== "mock") return;

    const onVisibilityChange = () => {
      if (!document.hidden) setCameraRetryToken((prev) => prev + 1);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [inSession, mode]);

  useEffect(() => {
    const shouldRunCamera = activeSessionKey !== null;
    if (!shouldRunCamera) {
      clearScanTimer();
      detectBusyRef.current = false;
      activeEngineRef.current = null;
      detectorRef.current = null;
      quaggaRef.current = null;
      stopCameraStream();
      setMode("idle");
      setDetectorEngine("초기화 전");
      return;
    }

    let cancelled = false;
    setMode("loading");
    setMockTitle(CAMERA_ERROR_TITLE);
    setMockMessage(CAMERA_ERROR_HINT);

    const start = async () => {
      const videoEl = videoRef.current;
      if (!videoEl) {
        if (!cancelled) {
          setMockTitle(CAMERA_ERROR_TITLE);
          setMockMessage(CAMERA_ERROR_HINT);
          setMode("mock");
        }
        return;
      }

      try {
        const nativeCtor = (window as WindowWithBarcodeDetector).BarcodeDetector;
        let useNative = false;
        let nativeFormats: string[] = [];

        if (nativeCtor && typeof nativeCtor.getSupportedFormats === "function") {
          try {
            const supported = await nativeCtor.getSupportedFormats();
            const canUseNativeFormats =
              supported.includes("ean_13") ||
              supported.includes("code_128") ||
              supported.includes("code_39");
            if (canUseNativeFormats) {
              nativeFormats = BARCODE_FORMATS.filter((fmt) => supported.includes(fmt));
              useNative = nativeFormats.length > 0;
            }
          } catch {
            useNative = false;
          }
        }

        if (useNative && nativeCtor) {
          detectorRef.current = new nativeCtor({ formats: nativeFormats });
          quaggaRef.current = null;
          activeEngineRef.current = "native";
          setDetectorEngine("Native BarcodeDetector");
        } else {
          const quagga2Pkg = (await import("@ericblade/quagga2")) as {
            default: QuaggaLike;
          };
          quaggaRef.current = quagga2Pkg.default;
          detectorRef.current = null;
          activeEngineRef.current = "quagga";
          setDetectorEngine("Quagga2 Fallback");
        }
      } catch {
        if (!cancelled) {
          setMockTitle("스캔 엔진을 켤 수 없어요");
          setMockMessage(UNSUPPORTED_MESSAGE);
          setMode("mock");
        }
        detectorRef.current = null;
        return;
      }

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          if (!cancelled) {
            setMockTitle(CAMERA_ERROR_TITLE);
            setMockMessage(CAMERA_ERROR_HINT);
            setMode("mock");
          }
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { min: 1280, ideal: 1920, max: 3840 },
            height: { min: 720, ideal: 1080, max: 2160 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          await applyVideoTrackScanOptimizations(videoTrack);
        }

        streamRef.current = stream;
        videoEl.srcObject = stream;
        await videoEl.play();

        if (cancelled) return;
        setMode("camera");
      } catch {
        if (cancelled) return;
        stopCameraStream();
        setMockTitle(CAMERA_ERROR_TITLE);
        setMockMessage(CAMERA_ERROR_HINT);
        setMode("mock");
      }
    };

    void start();

    return () => {
      cancelled = true;
      clearScanTimer();
      detectBusyRef.current = false;
      activeEngineRef.current = null;
      detectorRef.current = null;
      scanBufferRef.current = [];
      if (quaggaRef.current?.stop) {
        try {
          quaggaRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      quaggaRef.current = null;
      stopCameraStream();
    };
  }, [activeSessionKey, cameraRetryToken, clearScanTimer, stopCameraStream]);

  useEffect(() => {
    if (!inSession || mode !== "camera") return;

    const pushScanConsensus = (code: string, engine: "native" | "quagga") => {
      const buf = scanBufferRef.current;
      const requiredHits = engine === "native" ? 2 : 2;
      buf.push(code);
      while (buf.length > 3) buf.shift();
      if (buf.length < requiredHits) return;
      const allSame = buf.slice(-requiredHits).every((v) => v === buf[buf.length - 1]);
      if (!allSame) return;
      handleDecoded(buf[buf.length - 1]);
      scanBufferRef.current = [];
    };

    const tick = async () => {
      if (detectBusyRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      detectBusyRef.current = true;
      try {
        const engine = activeEngineRef.current;
        if (engine === "native") {
          const detector = detectorRef.current;
          if (!detector) return;
          const result = await detector.detect(video);
          const rawValue = result[0]?.rawValue?.trim();
          if (rawValue && VALID_BARCODE.test(rawValue)) {
            pushScanConsensus(rawValue, "native");
          }
          return;
        }

        if (engine === "quagga") {
          const quagga = quaggaRef.current;
          const canvas = frameCanvasRef.current;
          if (!quagga || !canvas) return;
          const vw = video.videoWidth || 1280;
          const vh = video.videoHeight || 720;
          /** 중앙 ROI: 가로 넓게·세로는 좁혀 같은 프레임에서 바코드에 더 많은 가로 픽셀을 할당 (Quagga 뷰파인더와 동일 비율) */
          const roiWidthFrac = 0.9;
          const roiHeightFrac = 0.72;
          const cropW = Math.max(1, Math.floor(vw * roiWidthFrac));
          const cropH = Math.max(1, Math.floor(vh * roiHeightFrac));
          const sx = Math.floor((vw - cropW) / 2);
          const sy = Math.floor((vh - cropH) / 2);
          if (canvas.width !== cropW) canvas.width = cropW;
          if (canvas.height !== cropH) canvas.height = cropH;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

          const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, "image/jpeg", 0.82);
          });
          if (!blob) return;
          const objectUrl = URL.createObjectURL(blob);
          let result: QuaggaResultLike = null;
          try {
            result = await quagga.decodeSingle({
              src: objectUrl,
              locate: true,
              numOfWorkers: 0,
              inputStream: {
                type: "ImageStream",
                size: 1280,
              },
              locator: {
                patchSize: "large",
                halfSample: false,
              },
              decoder: {
                readers: [
                  "code_128_reader",
                  "code_39_reader",
                  "ean_reader",
                  "ean_8_reader",
                ],
              },
            });
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
          const rawValue = result?.codeResult?.code?.trim();
          if (rawValue && VALID_BARCODE.test(rawValue)) {
            pushScanConsensus(rawValue, "quagga");
          }
        }
      } catch {
        /* ignore decode errors */
      } finally {
        detectBusyRef.current = false;
      }
    };

    clearScanTimer();
    scanTimerRef.current = window.setInterval(() => {
      void tick();
    }, SCAN_INTERVAL_MS);

    return () => {
      clearScanTimer();
      detectBusyRef.current = false;
      scanBufferRef.current = [];
      if (quaggaRef.current?.stop) {
        try {
          quaggaRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      const canvas = frameCanvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [clearScanTimer, handleDecoded, inSession, mode]);

  const showCameraArea = inSession;
  const showMockPanel = inSession && mode === "mock";
  const showCameraLoading = showCameraArea && mode === "loading";

  const handleExitSession = () => {
    endInventorySession();
    onExitSession?.();
  };

  return (
    <div className="isolate flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-bg-base text-text-primary">
      {flashKey != null && (
        <div
          key={flashKey}
          className="pointer-events-none fixed inset-0 z-[95] box-border rounded-none border-[6px] border-solid border-transparent scan-success-flash"
          onAnimationEnd={() => setFlashKey(null)}
          aria-hidden
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {inSession && (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
            <AppHeader
              className="shrink-0"
              rightSlot={
                <>
                  <button
                    type="button"
                    ref={debugTriggerRef}
                    id="scan-debug-info-trigger"
                    aria-label="기기 정보와 소리 설정 열기"
                    aria-haspopup="dialog"
                    aria-expanded={debugInfoOpen}
                    aria-controls="scan-debug-info-dialog"
                    onClick={() => setDebugInfoOpen(true)}
                    className="press flex h-11 w-11 items-center justify-center rounded-full bg-bg-input text-text-secondary active:bg-border-default"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4" />
                      <path d="M12 8h.01" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={handleExitSession}
                    className="press min-h-11 rounded-full bg-bg-input px-4 text-[14px] font-semibold text-text-primary active:bg-border-default"
                  >
                    {totalBooks > 0 ? "점검 마치기" : "점검 중단"}
                  </button>
                </>
              }
            />
            <OnlineStatusBanner />

            {/* 진행 요약 — 토스풍 압축 카드: 총 권수 · 방금 인식 */}
            <div
              className="shrink-0 border-b border-border-default bg-bg-base px-4 pb-3 pt-2"
              aria-live="polite"
            >
              <div className="flex items-stretch justify-between gap-2">
                <div className="min-w-0 flex-1 rounded-xl bg-bg-subtle px-3 py-2">
                  <p className="text-[11px] font-semibold text-text-tertiary">
                    지금까지 점검
                  </p>
                  {lastCaptureAt > 0 ? (
                    <p
                      key={`total-${lastCaptureAt}`}
                      className="scan-total-hit mt-0.5 text-[22px] font-bold tabular-nums text-text-primary"
                    >
                      {totalBooks}
                      <span className="ml-1 text-[14px] font-semibold text-text-tertiary">
                        권
                      </span>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[22px] font-bold tabular-nums text-text-tertiary">
                      {totalBooks}
                      <span className="ml-1 text-[14px] font-semibold">권</span>
                    </p>
                  )}
                </div>
                <div className="min-w-0 flex-1 rounded-xl bg-bg-subtle px-3 py-2">
                  <p className="text-[11px] font-semibold text-text-tertiary">
                    방금 인식
                  </p>
                  {lastCapturedCode ? (
                    <p
                      key={`code-${lastCaptureAt}`}
                      className="scan-live-code-hit mt-0.5 truncate text-right text-[18px] font-bold tabular-nums text-accent-text"
                    >
                      {lastCapturedCode}
                    </p>
                  ) : (
                    <p className="mt-0.5 truncate text-right text-[13px] text-text-tertiary">
                      대기 중
                    </p>
                  )}
                </div>
              </div>
              {!lastCapturedCode && (
                <p className="mt-2 text-[12px] leading-snug text-text-tertiary">
                  바코드의{" "}
                  <span className="font-semibold text-text-secondary">
                    숫자 부분
                  </span>
                  이 가운데 사각형에 들어오게 비춰주세요.
                </p>
              )}
            </div>

            <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {showCameraArea && (
                <div
                  className={`relative z-20 w-full min-w-0 flex-1 overflow-hidden bg-[var(--gray-900)] ${
                    sessionEditMode ? "min-h-[38dvh]" : "min-h-[44dvh]"
                  }`}
                >
                  <canvas ref={frameCanvasRef} className="hidden" aria-hidden />
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 z-10 h-full w-full bg-[var(--gray-900)] object-cover"
                  />

                  {/* Quagga ROI(중앙, 가로 90% × 세로 72%) 가이드라인 오버레이 */}
                  <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
                    <div
                      className="relative h-[72%] w-[90%] rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                      aria-hidden
                    >
                      {/* corners — 목련 그린 (스캔 가이드) */}
                      <span className="absolute left-0 top-0 h-6 w-6 rounded-tl-md border-l-[3px] border-t-[3px] border-[var(--magnolia-400)]" />
                      <span className="absolute right-0 top-0 h-6 w-6 rounded-tr-md border-r-[3px] border-t-[3px] border-[var(--magnolia-400)]" />
                      <span className="absolute bottom-0 left-0 h-6 w-6 rounded-bl-md border-b-[3px] border-l-[3px] border-[var(--magnolia-400)]" />
                      <span className="absolute bottom-0 right-0 h-6 w-6 rounded-br-md border-b-[3px] border-r-[3px] border-[var(--magnolia-400)]" />
                    </div>
                  </div>

                  {/* 로딩 오버레이 */}
                  {showCameraLoading && (
                    <div
                      className="pointer-events-none absolute inset-0 z-[50] flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm"
                      aria-busy="true"
                    >
                      <span
                        className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-white/30 border-t-white"
                        aria-hidden
                      />
                      <p className="text-[14px] font-medium text-white">
                        카메라를 켜고 있어요…
                      </p>
                    </div>
                  )}

                  {/* 권한 오류 오버레이 */}
                  {showMockPanel && (
                    <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/85 px-5">
                      <div className="w-full max-w-md rounded-2xl bg-bg-card p-6 shadow-lg">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-warning-bg">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-6 w-6 text-warning"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        </div>
                        <h2 className="text-center text-[17px] font-bold text-text-primary">
                          {mockTitle}
                        </h2>
                        <p className="mt-2 text-center text-[13px] leading-relaxed text-text-secondary">
                          {mockMessage}
                        </p>
                        <button
                          type="button"
                          onClick={retryCamera}
                          className="press mt-5 min-h-[52px] w-full rounded-xl bg-brand px-4 text-[15px] font-semibold text-text-on-brand hover:bg-brand-hover"
                        >
                          카메라 다시 연결하기
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div
          className={`pointer-events-none fixed left-3 right-3 z-[90] mx-auto max-w-md rounded-xl px-4 py-3 text-center text-[14px] font-medium shadow-lg ${
            toast.tone === "success"
              ? "bg-[var(--magnolia-600)] text-white"
              : "bg-toast-info-bg text-white"
          } ${
            sessionEditMode
              ? "bottom-[min(42vh,360px)]"
              : "bottom-[min(34vh,300px)]"
          }`}
          role="status"
          aria-live="polite"
        >
          {toast.text}
        </div>
      )}

      {inSession && (
        <div className="relative z-40 shrink-0 border-t border-border-default bg-bg-base px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <label
                htmlFor="scan-session-textarea"
                className="block text-[12px] font-semibold text-text-tertiary"
              >
                이번 점검 기록
              </label>
              <p className="mt-0.5 text-[11px] tabular-nums text-text-tertiary">
                바코드 {totalBooks}권
              </p>
            </div>
            {sessionEditMode ? (
              <button
                type="button"
                onClick={exitSessionEditMode}
                className="press flex min-h-11 shrink-0 items-center justify-center rounded-full bg-accent px-5 text-[14px] font-semibold text-text-on-brand"
              >
                수정 완료
              </button>
            ) : (
              <button
                type="button"
                onClick={enterSessionEditMode}
                className="press flex min-h-11 shrink-0 items-center justify-center rounded-full bg-bg-input px-5 text-[14px] font-semibold text-text-primary active:bg-border-default"
              >
                직접 수정
              </button>
            )}
          </div>
          {sessionEditMode && (
            <p className="mb-2 text-[12px] leading-snug text-text-tertiary">
              한 줄에 번호 하나씩. 잘못 찍힌 줄은 지우거나 고쳐 주세요.
            </p>
          )}
          <textarea
            ref={sessionTextareaRef}
            id="scan-session-textarea"
            value={liveSessionText}
            readOnly={!sessionEditMode}
            aria-readonly={sessionEditMode ? undefined : "true"}
            onChange={
              sessionEditMode
                ? (e) => setLiveSessionText(e.target.value)
                : undefined
            }
            placeholder={
              sessionEditMode
                ? "한 줄에 번호 하나씩"
                : "여기에 찍은 번호가 쌓여요"
            }
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            tabIndex={sessionEditMode ? 0 : -1}
            className={`w-full resize-none rounded-xl px-3.5 py-3 font-mono text-[15px] leading-relaxed tabular-nums text-text-primary outline-none ${
              sessionEditMode
                ? "min-h-[12rem] max-h-[36dvh] border border-accent bg-bg-input focus:border-accent"
                : "min-h-[8rem] max-h-[26dvh] cursor-default bg-bg-input"
            }`}
          />
        </div>
      )}

      {inSession && debugInfoOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-6"
          role="presentation"
          onClick={() => setDebugInfoOpen(false)}
        >
          <div
            ref={debugDialogRef}
            id="scan-debug-info-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-debug-info-title"
            className="w-full max-w-md rounded-2xl bg-bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="scan-debug-info-title"
              className="text-[17px] font-bold text-text-primary"
            >
              기기 정보 · 소리 설정
            </h2>

            <button
              type="button"
              onClick={toggleSoundMuted}
              role="switch"
              aria-checked={!soundMuted}
              className={`press mt-4 flex min-h-[60px] w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left ${
                soundMuted ? "bg-warning-bg" : "bg-bg-subtle"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-text-primary">
                  스캔 소리
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-text-secondary">
                  조용한 곳에서는 꺼두세요. 진동과 화면 깜빡임은 그대로
                  유지돼요.
                </span>
              </span>
              <span
                aria-hidden
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
                  soundMuted ? "bg-border-strong" : "bg-accent"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    soundMuted ? "translate-x-1" : "translate-x-6"
                  }`}
                />
              </span>
            </button>

            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
              <dt className="text-text-tertiary">브라우저</dt>
              <dd className="text-right text-text-secondary">
                {clientInfo.browser}
              </dd>
              <dt className="text-text-tertiary">OS</dt>
              <dd className="text-right text-text-secondary">{clientInfo.os}</dd>
              <dt className="text-text-tertiary">진동</dt>
              <dd className="text-right text-text-secondary">
                {vibrationSupportLabel}
              </dd>
              <dt className="text-text-tertiary">스캔 엔진</dt>
              <dd className="text-right text-text-secondary">
                {detectorEngine}
              </dd>
            </dl>

            <button
              type="button"
              onClick={() => setDebugInfoOpen(false)}
              className="press mt-5 min-h-[52px] w-full rounded-xl bg-bg-input px-4 text-[15px] font-semibold text-text-primary active:bg-border-default"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
