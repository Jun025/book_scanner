# 장서점검 스캐너 (Book Scanner PWA)

도서관 장서점검용 **고속 바코드 스캐너**입니다. Next.js 기반 PWA로 모바일 브라우저에서 설치 없이 사용하거나 홈 화면에 추가할 수 있습니다.

핵심 멘탈 모델은 단순합니다 — **한 세션 = 한 번의 점검 = 한 번 복붙**. 학생 사용자가 매일 보는 화면당 하나의 명확한 행동만 둡니다.

> 사용자(학생·사서 선생님)용 안내서는 [`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md)에서 확인하세요.
> 회차별 변경 기록은 [`docs/CHANGELOG.md`](./docs/CHANGELOG.md)를 참고하세요.

## 주요 기능

### 점검 흐름
- **장서점검 시작** — 진입 직후 카메라는 꺼짐. 버튼으로 세션을 연 뒤에만 카메라가 동작.
- **연속 스캔** — 세션 유지 중 바코드만 비추면 반복 인식(별도 셔터 없음). 진동, 테두리 녹색 플래시, 토스트 "기록했어요 · NNNN"으로 인지 피드백. 도서관 정숙 환경 부담을 이유로 청각 비프는 사용하지 않습니다.
- **점검 중에도 바로 복사** — 진행 화면 하단 라벨 행에 "복사" 버튼을 두어 권수>0일 때 현재까지 기록을 클립보드로 보낼 수 있어요. 학생이 점검 중간에 사서께 보내고 싶을 때 즉시 사용 가능.
- **점검 종료 버튼** — 진행 화면 상단 "지금까지 점검" 카드 **왼쪽의 셰브런-백 아이콘**(권수에 따라 aria-label이 "점검 마치고"/"점검 중단하고 이전 화면으로"로 분기). 확인 팝업 없이 즉시 종료.
- **종료 후 자동 백업 권유** — 1줄 이상 기록이 남은 채 종료하면 메인이 아니라 방금 끝낸 세션의 **지난 점검 상세**로 바로 이동. 상단에 "방금 점검한 N권이 저장됐어요. 사서 선생님께 전달하려면 아래 복사 버튼을 눌러주세요" 배너가 한 번 노출되어 사용자가 그 자리에서 복사·전달을 끝낼 수 있다(비차단형, 모달 아님).

### 데이터 저장 & 안전망
- **세션 키 = 시작 시각** — `localStorage` 키는 `book-scanner:session:` + ISO8601(점검 시작 일시). 한 세션의 모든 스캔은 그 키 하나의 값에 줄바꿈으로 누적.
- **스캔 즉시 저장** — 유효한 숫자가 인식될 때마다 `localStorage`에 바로 append. 종료 시점에 일괄 저장하지 않음.
- **시계 점프 충돌 방어** — OS 시각이 되감겨 동일 ISO가 다시 만들어져도 `-2`, `-3`, ... suffix로 새 고유 키를 발급해 기존 본문을 절대 덮어쓰지 않음.
- **메인 정리** — 메인으로 들어올 때 바코드 0건인 활성 세션은 자동 제거. 휴지통 세션은 사용자 의도 보존을 위해 건드리지 않음.

### 지난 점검 기록 & 휴지통
- **지난 점검 기록 목록** — 활성(휴지통 아님) 세션을 최신순으로 나열. 항목을 열어 상세의 textarea로 조회·수정·클립보드 복사. 목록 행에서는 복사하지 않음(잘못된 항목의 우발적 복사 방지).
- **다중 선택(예외 동선)** — 헤더의 **"선택"** 버튼으로 다중 선택 모드 진입 → 항목 탭으로 토글 → 하단의 **"선택한 N개 휴지통으로 보내기"** 버튼으로 일괄 처리. 일상 점검 동선에는 다중 선택을 두지 않고, 학기 말 정리 같은 명백한 관리 작업에 한해 허용하는 패턴이다.
- **휴지통(2단계 삭제 + 미리보기)** — "삭제"는 즉시 영구 삭제가 아니라 **휴지통으로 이동**(소프트 삭제). 지난 점검 목록 하단의 **"휴지통 (N) →"** 진입점에서 보관 중인 점검 기록을 보고, 항목별 **[복구]** 또는 **[영구 삭제]** 중 하나를 골라야 영구 삭제가 일어난다. 항목 상단을 탭하면 상세 화면으로 들어가 **본문 내용을 읽고**(편집은 잠금, 복사는 가능) 거기서도 복구·영구 삭제할 수 있어 영구 삭제 직전에 안전하게 내용을 확인할 수 있다. 본문은 휴지통에 있는 동안 그대로 보존되어 실수로 삭제해도 되돌릴 수 있다.
- **백업 추적(복사한 적 있음/신규)** — 각 세션이 한 번이라도 복사됐는지를 본문과 분리된 메타 네임스페이스(`book-scanner:meta:`)에 별도 저장. 진행 중 복사·상세 복사가 실제 성공하면 자동으로 "복사한 적 있음" 처리. 지난 점검 목록에서 권수>0 세션에 **"✓ 복사한 적 있음"**(목련 그린, 완료 톤) 또는 **"● 신규"**(연꽃 로즈, 강조 톤) 작은 뱃지로 구분되어, 학생도 사서 선생님도 어느 점검이 아직 전달 안 됐는지 한눈에 본다. 종료 직후 자동 진입 배너는 이미 복사된 세션이면 노출되지 않아 중복 안내가 없다.

### 화면 정책
- **헤더** — "도서부 빛나래 / 빛나래 장서점검" 헤더는 **홈 화면에만 노출**. 점검 진행·지난 점검 목록/상세에는 헤더를 두지 않아 카메라·콘텐츠 영역을 넓게 쓴다.
- **푸터** — 도서관 인스타그램 링크 + 기기 정보(`i`) 버튼(브라우저·OS·진동 지원 여부 다이얼로그). 모든 화면 공통.
- **오프라인 안내 띠** — 네트워크가 끊기면 모든 화면(홈·점검 진행·지난 점검 목록·상세) 최상단에 얇은 띠가 뜬다("오프라인이에요. 기록은 이 기기에 그대로 저장돼요"). 본 앱은 오프라인에서도 정상 동작하므로 경고가 아닌 안심 톤이며, 헤더와 독립적으로 동작해 비홈 화면(헤더가 없는 화면)에서는 `topmost` 모드로 노치 safe-area를 직접 흡수한다.
- **첫 화면 뒤로가기** — 히스토리 루트에서 뒤로가기 시 확인 없이 앱 이탈 시퀀스 실행.

### 스캔 정확성
- **엔진 자동 선택** — Native `BarcodeDetector` 우선, 미지원 환경은 `@ericblade/quagga2`로 폴백.
- **검증** — 스캔 UI에서 `trim` 후 **`/^\d{5,13}$/`** 만 합의·저장 후보로 사용. 스토어에서 **`/^\d+$/`** 재검증 및 **동일 코드 ~2초 쿨다운**.
- **오인식 방지** — 유효 코드가 2회 연속 동일할 때만 확정 저장(멀티 프레임 합의).
- **중앙 ROI 스캔(Quagga)** — 비디오 중앙을 **가로 90% × 세로 72%**로 크롭해 디코딩하고, 뷰파인더 가이드와 동일 비율. `decodeSingle`은 버퍼 **1280**·`halfSample: false`·`patchSize: "large"`로 작은 바코드 인식을 보강.
- **카메라** — 가능한 경우 고해상도·디지털 줌·연속 초점 제약을 시도(미지원 기기는 무시). 실패 시 안내 목업 +「카메라 다시 연결하기」 버튼.
- **라이브 표시** — 스캔 중 권수·「방금 인식」 대형 숫자 + 강조 애니메이션.

## 기술 스택

| 영역 | 사용 |
|------|------|
| 프레임워크 | Next.js 16 (App Router), React 19 |
| 스타일 | Tailwind CSS 4 |
| 스캐너 | Native `BarcodeDetector` + `@ericblade/quagga2` |
| 상태 | Zustand 5 (세션/UI 런타임; 스캔 본문은 persist 없음) |
| 저장소 | `localStorage` (세션별 키 + 메타 네임스페이스) |
| PWA | @ducanh2912/next-pwa |
| 테스트 | Vitest + jsdom (순수 로직 단위 테스트) |

## 시작하기

패키지 매니저는 **pnpm** 기준입니다. `npm`/`yarn`을 쓰면 각 도구에 맞게 설치하세요.

```bash
pnpm install
pnpm dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 엽니다. 개발 모드에서는 PWA 서비스 워커가 비활성화되어 있습니다.

## 빌드 · 테스트

```bash
pnpm build   # next build --webpack
pnpm test    # vitest run
pnpm lint    # eslint
```

## 프로젝트 구조 (요약)

- `src/app/layout.tsx` — 폰트·viewport·PWA 메타
- `src/app/page.tsx` — 메인·지난 점검 목록/상세·휴지통·스캔 모드 전환, 히스토리·뒤로가기·클립보드(상세만)
- `src/components/Scanner.tsx` — 카메라/목업, 라이브 패널, 누적 보기·직접 수정 토글, 토스트
- `src/components/AppHeader.tsx` — 공통 헤더(홈에서만 노출)
- `src/components/AppFooter.tsx` — 푸터(인스타 링크 + 기기 정보 버튼)
- `src/components/DebugInfoButton.tsx` — 푸터에서 열리는 기기 정보 다이얼로그(브라우저·OS·진동)
- `src/components/OnlineStatusBanner.tsx` — 오프라인 상태 안내 띠
- `src/hooks/useScreenWakeLock.ts` — 카메라 동작 중 화면 꺼짐 방지
- `src/store/useScannerStore.ts` — 세션 생명주기, `localStorage` append/동기, 키 충돌 방어
- `src/store/sessionMeta.ts` — 세션 메타(`book-scanner:meta:` 네임스페이스, `backedUpAt`/`deletedAt`)
- `src/lib/sessionText.ts` — 줄 수·클립보드용 정규화
- `src/lib/brand.ts` — 푸터 외부 링크 상수
- `public/manifest.json` — PWA 메타데이터

자세한 요구·로드맵은 [`PRD.md`](./PRD.md)를 참고하세요.

## 배포 (Cloudflare Pages)

이 프로젝트는 `@opennextjs/cloudflare` 기반으로 Cloudflare Pages(Workers 런타임) 배포를 사용합니다.

### 1) 사전 준비

1. Cloudflare 계정과 Pages 프로젝트를 생성합니다.
2. 로컬에서 Cloudflare 인증을 완료합니다.

```bash
pnpm dlx wrangler login
```

### 2) Pages 빌드 설정

Cloudflare Pages에서 이 저장소를 연결한 뒤, Build 설정을 아래처럼 지정합니다.

- Framework preset: `None`
- Build command: `pnpm opennextjs-cloudflare build`
- Build output directory: `.open-next/assets`

OpenNext 빌드 결과(`.open-next/worker.js`)가 서버 렌더링/라우트 처리를 담당하고, 정적 파일은 `.open-next/assets`에서 서빙됩니다.

> ⚠️ **빌드 명령은 반드시 `pnpm build` 스크립트를 경유해야 합니다.**
> `@ducanh2912/next-pwa`는 webpack 전용 플러그인이라 Next.js 16의 기본 번들러(Turbopack)에서는 동작하지 않습니다.
> `pnpm build` 스크립트는 `next build --webpack`을 호출해 PWA(서비스 워커·workbox 파일)를 생성하지만,
> `next build`를 직접 호출하면 PWA가 누락된 채로 빌드가 끝납니다.
> 위 권장 명령 `pnpm opennextjs-cloudflare build`는 내부적으로 `pnpm build`를 실행하므로 안전합니다.
> 만약 `open-next.config.ts`에서 `buildCommand`를 직접 지정하게 된다면 반드시 `pnpm build`(또는 `next build --webpack`)로 지정하세요.
> 프로덕션 환경에서 `--webpack` 없이 빌드가 시작되면 `next.config.ts`의 가드가 즉시 빌드를 실패시킵니다.

### 3) 필요한 설정 파일

프로젝트 루트에 `wrangler.jsonc`가 없다면 생성합니다.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "main": ".open-next/worker.js",
  "name": "book-scanner",
  "compatibility_date": "2024-12-30",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  }
}
```

### 4) 배포 워크플로

1. `main` 브랜치에 push/merge 합니다.
2. Cloudflare Pages가 자동으로 `pnpm opennextjs-cloudflare build`를 실행합니다.
3. 빌드가 끝나면 새 배포가 생성됩니다.

로컬에서 Workers 런타임으로 미리 확인하려면 아래 명령을 사용합니다.

```bash
pnpm opennextjs-cloudflare build
pnpm wrangler dev
```

## 참고

- 스캔 데이터는 **브라우저·기기별** `localStorage`에만 존재합니다. 다른 기기와 자동 동기화되지 않습니다.
