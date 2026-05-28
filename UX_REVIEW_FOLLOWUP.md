# 빛나래 장서점검 UX 후속 점검 (2026-05-22, 동일 일자 2회차)

리뷰어: 시니어 프론트엔드.
기준 브랜치: `ux-followup-2026-05-22` (직전 UX 작업 직후 main `49cf02d`에서 분기).

본 점검은 (1) 직전 8개 커밋의 회귀·미완성 검증, (2) 그 외 남은 문제 조사를 목적으로 한다.

> ⚠ **2026-05-28 후속 변경 안내** — 본 문서는 2026-05-22 시점 스냅샷입니다.
> 이후 비프 시스템 제거 · 헤더 정리 · info/종료 버튼 위치 이동 등이 반영
> 되었으니 현재 동작은 `README.md` · `PRD.md` · `.cursorrules`를 우선 참고하세요.
> 자세한 변경 목록은 `UX_REVIEW.md` 상단의 동일 안내 박스를 참고하세요.

## 1. 직전 작업 회귀 점검 결과

| 영역 | 점검 | 결과 |
|---|---|---|
| Wake Lock | 미지원/거부/visibility 변화/cleanup race | 안전. `wakeLockApi` 미존재 시 early return, `request` try/catch, visible 가드, cancelled 가드, cleanup release 모두 처리됨. (`src/hooks/useScreenWakeLock.ts`) |
| 음소거 토글 영속성 | localStorage 저장/복원, SSR/hydration 시점 | 안전. 첫 렌더 false → 마운트 후 setSoundMuted로 보정, prefix `book-scanner:settings:`로 세션 prefix와 분리. private mode try/catch 있음. (`Scanner.tsx:170-191`) |
| 오프라인 띠 | `navigator.onLine` 한계 | 한계가 있으나 안내 톤이고 사용자 동선을 막지 않음. false negative(실제 끊김인데 띠 안 보임)는 기존 동작과 동일 — 새로운 손해 없음. |
| 토스트/대비/모드 구분 | 레이아웃/터치 타깃 | 동일 padding·font·min/max로 두 모드 모두 동일 영역 유지. 새 토스트는 `pointer-events-none`이라 터치 차단 없음. |
| 빌드/lint | 새로운 error/warning 도입 여부 | `pnpm lint` 결과 0 errors / 88 warnings — 직전 push 시점과 정확히 동일. 빌드 통과. |

**결론: 직전 작업의 회귀·미완성 없음.** 별도로 고친 항목 없음.

## 2. 본 점검에서 새로 발견·처리한 항목

### 2.1 적용 (이 PR에 포함)

| 항목 | 심각도 | 근거 | 처리 |
|---|---|---|---|
| 리스트 항목 카운트 재계산 비용 | 중간(잠재 성능) | `src/app/page.tsx` 기존 list 렌더 안에서 `readSessionRaw(key)`를 매 항목·매 렌더마다 호출 | `useMemo`로 `{ key → 줄 수 }` 캐시. 동작 동일, 부담만 감소. (커밋: `perf: 리스트 항목 카운트 메모화`) |
| 스캔 화면 라이브 패널 라벨 대비 누락 | 낮음(직전 PR 누락분) | `Scanner.tsx`의 "지금까지 점검", "방금 인식", "카메라 준비 중…" 텍스트가 직전 대비 보강에서 빠져 있었음 | `text-zinc-500/400` → 한 단계 밝게. 레이아웃 동일. (커밋: `style: 스캔 화면 라이브 패널 라벨 대비 보강`) |
| PWA 메타데이터 미흡 | 낮음 | `public/manifest.json`에 `lang/dir/categories` 누락 | 추가. OS·앱 카탈로그가 올바른 언어/분류로 표시. (커밋: `chore: PWA 메타데이터·robots 보강`) |
| 검색엔진 색인 | 중간 | 학교 내부 도구임에도 `layout.tsx` metadata에 `robots` 미설정 | `robots: { index: false, follow: false }` 추가. 학교명 검색으로 외부에서 우연히 진입할 가능성 차단. |
| 점검 기록 삭제 후 뒤로가기 시 빈 detail 화면 | 중간(기존 UX 버그) | `page.tsx onDelete`는 detail에서 push한 history 항목을 정리하지 않음 → 뒤로가기 시 `selectedKey=null` 상태로 detail이 다시 렌더되어 빈 화면 노출 | `onDelete` 끝에 `window.history.back()` 추가. setAdminView와 popstate 처리는 멱등하게 중첩되어 무해. (커밋: `fix: 점검 기록 삭제 후 빈 detail 화면 노출 방지`) |

### 2.2 보류 — 사람 확인 필요

- **음소거 시 `prime()` 우회**: 미세한 리소스 절약이지만, 음소거 해제 후 첫 비프가 사용자 제스처 밖에서 호출되면 iOS Safari가 AudioContext.resume()을 거부할 가능성이 있어 회귀 위험. 현재처럼 prime을 항상 호출하는 편이 안전.
- **`userScalable=false` 해제**: 직전 점검과 동일한 이유로 보류(카메라+textarea 동시 사용 시 핀치줌 오작동 가능성).
- **카메라 손전등(Torch) 토글**: 기기별 capability 호환 확인 필요, 별도 PR 권장.
- **"이 점검 삭제하기" 버튼 색상 강조**: 현재 `border-red-900/70 + bg-red-950/40` 톤이 위험 액션 시그널로 다소 약함. 단 confirm 가드가 있고, 진한 빨강은 다크 테마의 amber/emerald 톤과의 균형을 깰 수 있어 디자인 결정 필요.
- **`textarea` 지난 점검 상세 톤**: 보기/편집 모드 구분(직전 PR)과 시각적 일관성 측면에서 emerald ring focus만으로 충분하다고 판단. 현 상태 유지.
- **`onCopy` 실패 시 `window.alert`**: PWA에서 거슬리는 모달. 토스트로 대체 가능하지만 페이지 자체의 toast 시스템을 새로 만들어야 해 범위 초과.

## 3. 검증 결과

브랜치 head에서 실행:

```
pnpm install --prefer-offline → Already up to date (변경 없음)
pnpm lint → ✖ 88 problems (0 errors, 88 warnings)
   직전 push 시점과 0/88로 정확히 동일. 새 error/warning 도입 없음.
pnpm build → Compiled successfully, 정적 페이지 6/6 생성, 라우트 정상.
```

- TypeScript: `next build` 내부의 TypeScript 검사 통과.
- 핵심 흐름 API (`beginInventorySession`/`endInventorySession`/`appendDigitScanToActiveSession`/`removeSessionKeysWithZeroBarcodes`) 시그니처·호출처 유지.
- next-pwa, manifest, 서비스워커 등록 — 손대지 않음(manifest는 메타데이터 필드만 추가, 핵심 필드 변경 없음).
- 빌드 산출물(`public/sw.js`)은 본 PR에 커밋하지 않음(자동 재빌드 시 갱신).

## 4. push 커밋 범위

main에 fast-forward로 머지될 커밋 (`49cf02d..HEAD`):

```
fix: 점검 기록 삭제 후 빈 detail 화면 노출 방지
chore: PWA 메타데이터·robots 보강
style: 스캔 화면 라이브 패널 라벨 대비 보강
perf: 리스트 항목 카운트 메모화
```

(+ 본 문서 커밋 1개)

## 5. 출근 후 실기기 확인 권고

1. **삭제 후 뒤로가기 동작**: 지난 점검 상세에서 한 항목을 삭제 → 자동으로 목록으로 이동 → 모바일 기기에서 시스템 뒤로가기/제스처를 눌렀을 때 빈 detail 화면이 보이지 않고 메인이 정상 노출되는지.
2. **manifest 변경 반영**: PWA로 홈 화면에 추가된 상태라면 한 번 캐시 갱신(앱 재시작) 후 OS PWA 패널에서 카테고리/언어가 올바르게 표시되는지.
3. **검색 노출**: 외부 검색에서 학교명+서비스명으로 검색해 즉시 사라지지는 않겠지만, 점진적으로 색인에서 빠지는지(시간 소요됨).
4. **목록 렌더 체감 속도**: 점검 기록이 누적된 기기에서 리스트 화면을 열었을 때 더 가볍게 열리는지(직접 측정은 어렵지만 체감 차이 가능).
