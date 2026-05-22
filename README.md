# 장서점검 스캐너 (Book Scanner PWA)

도서관 장서점검용 **고속 바코드 스캐너**입니다. Next.js 기반 PWA로 모바일 브라우저에서 설치 없이 사용하거나 홈 화면에 추가할 수 있습니다.

## 주요 기능

- **장서점검 시작** — 진입 직후 카메라는 꺼짐. 버튼으로 세션을 연 뒤에만 카메라가 동작.
- **엔진 자동 선택** — Native `BarcodeDetector` 우선, 미지원 환경은 `@ericblade/quagga2`로 폴백.
- **세션 키 = 시작 시각** — `localStorage` 키는 `book-scanner:session:` + ISO8601(점검 시작 일시). 한 세션의 모든 스캔은 그 키 하나의 값에 줄바꿈으로 누적.
- **스캔 즉시 저장** — 유효한 숫자가 인식될 때마다 `localStorage`에 바로 append. 점검 중단 시 일괄 저장하지 않음.
- **점검 중단** — 확인 팝업 없이 즉시 세션 종료 후 첫 화면으로 복귀.
- **메인 정리** — 메인으로 들어올 때 바코드 0건인 세션은 `removeSessionKeysWithZeroBarcodes()`로 제거 후 건수·목록 반영.
- **첫 화면 뒤로가기** — 히스토리 루트에서 뒤로가기 시 확인 없이 앱 이탈 시퀀스 실행.
- **지난 점검 기록** — 목록에서 항목을 열어 상세의 textarea로 조회·수정·삭제. **클립보드 복사는 상세에서만**(목록 행·점검 중 화면에서는 복사 없음).
- **점검 중 표시** — 하단 누적은 보기 모드 기본(스캔으로 갱신·맨 아래 자동 스크롤). **직접 수정** 토글로 textarea 편집·즉시 `localStorage` 저장. 복사는 **지난 점검 상세**만.
- **연속 스캔** — 세션 유지 중 바코드만 비추면 반복 인식(별도 셔터 없음).
- **검증** — 스캔 UI에서 `trim` 후 **`/^\d{5,13}$/`** 만 합의·저장 후보로 사용. 스토어에서 **`/^\d+$/`** 재검증 및 **동일 코드 ~2초 쿨다운**.
- **오인식 방지** — 유효 코드가 2회 연속 동일할 때만 확정 저장(멀티 프레임 합의).
- **중앙 ROI 스캔(Quagga)** — 비디오 중앙을 **가로 90% × 세로 72%**로 크롭해 디코딩하고, 뷰파인더 가이드와 동일 비율. `decodeSingle`은 버퍼 **1280**·`halfSample: false`·`patchSize: "large"`로 작은 바코드 인식을 보강.
- **카메라** — 가능한 경우 고해상도·디지털 줌·연속 초점 제약을 시도(미지원 기기는 무시).
- **피드백** — 진동(지원 기기), 테두리 녹색 플래시, 토스트, Web Audio 비프(`useScanBeeps`).
- **라이브 표시** — 스캔 중 권수·「방금 인식」대형 숫자 + 강조 애니메이션.
- **디버그 팝업 분리** — 상단 `i` 버튼으로만 디버그 정보를 열어 카메라 화면을 넓게 유지.
- **카메라 실패 시** — 안내 목업과「카메라 다시 연결하기」버튼(가상 숫자 입력 데모는 없음).

## 기술 스택

| 영역 | 사용 |
|------|------|
| 프레임워크 | Next.js 16 (App Router), React 19 |
| 스타일 | Tailwind CSS 4 |
| 스캐너 | Native `BarcodeDetector` + `@ericblade/quagga2` |
| 상태 | Zustand 5 (세션/UI 런타임; 스캔 본문은 persist 없음) |
| 저장소 | `localStorage` (세션별 키, `useScannerStore.ts` 헬퍼) |
| PWA | @ducanh2912/next-pwa |

## 시작하기

패키지 매니저는 **pnpm** 기준입니다. `npm`/`yarn`을 쓰면 각 도구에 맞게 설치하세요.

```bash
pnpm install
pnpm dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 엽니다. 개발 모드에서는 PWA 서비스 워커가 비활성화되어 있습니다.

## 빌드

```bash
pnpm build
pnpm start
```

## 프로젝트 구조 (요약)

- `src/app/layout.tsx` — 폰트·viewport·PWA 메타
- `src/app/page.tsx` — 메인·지난 점검 목록/상세·스캔 모드 전환, 히스토리·뒤로가기·클립보드(상세만)
- `src/components/Scanner.tsx` — 카메라/목업, 라이브 패널, 누적 보기·직접 수정 토글, 토스트, 비프
- `src/components/AppHeader.tsx` / `AppFooter.tsx` — 공통 헤더, 푸터(인스타 링크 등)
- `src/store/useScannerStore.ts` — 세션 생명주기, `localStorage` append/동기, 세션 키·빈 세션 정리
- `src/hooks/useScanBeeps.ts` — 스캔 성공/실패 톤
- `src/lib/sessionText.ts` — 줄 수·클립보드용 정규화
- `src/lib/brand.ts` — 푸터 외부 링크 상수
- `public/manifest.json` — PWA 메타데이터

자세한 요구·로드맵은 [PRD.md](./PRD.md)를 참고하세요.

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
