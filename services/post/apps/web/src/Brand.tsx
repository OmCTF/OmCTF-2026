export function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M11 9h15a10 10 0 0 1 10 10v3H25a6 6 0 0 0-6 6v2H8l-5 5V17a8 8 0 0 1 8-8Z"
        fill="currentColor"
      />
      <path
        d="M37 39H22a10 10 0 0 1-10-10v-3h11a6 6 0 0 0 6-6v-2h11l5-5v18a8 8 0 0 1-8 8Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <a className="brand wordmark" href="/" aria-label="Связь, главная">
      <BrandMark size={38} />
      <span>связь</span>
    </a>
  );
}

export function EmptyArt({ kind = "chat" }: { kind?: "chat" | "friends" | "search" | "inbox" }) {
  return (
    <svg
      className={`empty-art empty-art-${kind}`}
      width="240"
      height="160"
      viewBox="0 0 240 160"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="120" cy="142" rx="84" ry="7" fill="currentColor" opacity=".06" />
      <path
        d="M43 72c0-31 24-55 55-55h44c31 0 55 24 55 55s-24 55-55 55H98c-31 0-55-24-55-55Z"
        fill="currentColor"
        opacity=".05"
      />
      <g className="empty-art-float">
        <rect x="51" y="43" width="118" height="77" rx="18" fill="#30313b" />
        <path d="m70 111-4 22 26-17" fill="#30313b" />
        <rect x="86" y="29" width="108" height="74" rx="18" fill="#45465a" />
        <path d="m178 94 6 22-29-16" fill="#45465a" />
        {kind === "search" ? (
          <g stroke="#a4a4c3" strokeWidth="6" strokeLinecap="round">
            <circle cx="133" cy="60" r="16" />
            <path d="m146 74 16 16" />
          </g>
        ) : kind === "friends" ? (
          <g fill="#a4a4c3">
            <circle cx="126" cy="55" r="10" />
            <circle cx="155" cy="55" r="10" />
            <path d="M110 85c0-22 32-22 32 0M140 85c0-22 30-22 30 0" />
          </g>
        ) : kind === "inbox" ? (
          <path
            d="M113 50h55v34h-55Zm0 0 28 21 27-21"
            stroke="#a4a4c3"
            strokeWidth="4"
            strokeLinejoin="round"
          />
        ) : (
          <g fill="#b0b0d0">
            <circle cx="118" cy="65" r="5" />
            <circle cx="141" cy="65" r="5" />
            <circle cx="164" cy="65" r="5" />
          </g>
        )}
      </g>
      <path
        d="M38 36v10m-5-5h10M207 111v10m-5-5h10"
        stroke="#6f6f8b"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="203" cy="37" r="4" fill="#5865f2" opacity=".6" />
      <circle cx="35" cy="115" r="3" fill="#6f6f8b" />
    </svg>
  );
}
