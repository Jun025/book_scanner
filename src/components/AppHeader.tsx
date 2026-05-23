import type { ReactNode } from "react";

const SERVICE_TITLE = "빛나래 장서점검";

type AppHeaderProps = {
  /** 점검 화면 등 우측 액션(예: 점검 중단) */
  rightSlot?: ReactNode;
  className?: string;
};

export default function AppHeader({ rightSlot, className = "" }: AppHeaderProps) {
  return (
    <header
      className={`sticky top-0 z-30 flex min-h-[var(--header-height)] items-center gap-3 border-b border-border-default bg-bg-base/90 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md ${className}`}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-[10px] font-bold leading-tight text-brand-text"
        aria-label="동대부가람고 도서부 빛나래"
      >
        가람
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold tracking-wide text-text-tertiary">
          도서부 빛나래
        </p>
        <h1 className="truncate text-[17px] font-bold tracking-tight text-text-primary">
          {SERVICE_TITLE}
        </h1>
      </div>
      {rightSlot != null ? (
        <div className="flex shrink-0 items-center gap-2">{rightSlot}</div>
      ) : (
        <span className="w-1 shrink-0" aria-hidden />
      )}
    </header>
  );
}
