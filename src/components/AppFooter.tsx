import DebugInfoButton from "@/components/DebugInfoButton";
import InstagramIcon from "@/components/InstagramIcon";
import { INSTAGRAM_GARAM_LIB_URL } from "@/lib/brand";

type AppFooterProps = {
  className?: string;
};

export default function AppFooter({ className = "" }: AppFooterProps) {
  return (
    <footer
      className={`border-t border-border-default bg-bg-subtle px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${className}`}
    >
      <div className="mx-auto flex w-full max-w-[var(--container-max)] flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2">
          <a
            href={INSTAGRAM_GARAM_LIB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="가람고 도서관 인스타그램 새 창으로 열기"
            className="press inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border-default bg-bg-card px-4 py-2 text-[13px] font-semibold text-text-secondary hover:border-brand hover:text-brand"
          >
            <InstagramIcon className="h-4 w-4 shrink-0" />
            <span>도서관 인스타</span>
          </a>
          <DebugInfoButton />
        </div>
        <p className="text-[11px] leading-relaxed text-text-tertiary">
          동국대학교사범대학부속가람고등학교 · 도서부 동아리 빛나래
        </p>
      </div>
    </footer>
  );
}
