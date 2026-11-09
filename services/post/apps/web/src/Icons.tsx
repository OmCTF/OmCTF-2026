const paths = {
  refresh: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2",
  file: "M5 2h9l5 5v15H5ZM14 2v6h5M8 12h8M8 16h8",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  lock: "M6 11h12v10H6ZM8 11V7a4 4 0 0 1 8 0v4M12 15v2",
  palette:
    "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-3-4-6-9-6ZM7 8h.01M11 6h.01M16 7h.01M6 13h.01",
  smile: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 9h.01M16 9h.01M8 14s1 3 4 3 4-3 4-3",
  phone: "M3 15a13 13 0 0 1 18 0v4h-5v-4a14 14 0 0 0-8 0v4H3Z",
  expand: "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5",
  volume: "m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14",
  soundboard: "M4 4h16v16H4ZM8 9h.01M12 7h.01M16 9h.01M8 15h.01M12 17h.01M16 15h.01",
  home: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 10h10M7 14h6",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  plus: "M12 5v14M5 12h14",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  settings:
    "M10.3 2h3.4l.5 2.2 1.5.6 1.9-1.2 2.4 2.4-1.2 1.9.6 1.5 2.2.5v3.4l-2.2.5-.6 1.5 1.2 1.9-2.4 2.4-1.9-1.2-1.5.6-.5 2.2h-3.4l-.5-2.2-1.5-.6-1.9 1.2-2.4-2.4 1.2-1.9-.6-1.5-2.2-.5V9.9l2.2-.5.6-1.5-1.2-1.9 2.4-2.4 1.9 1.2 1.5-.6ZM15 11.6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  grip: "M9 5h.01M15 5h.01M9 10h.01M15 10h.01M9 15h.01M15 15h.01M9 20h.01M15 20h.01",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  inbox: "M4 4h16l2 10v6H2v-6Zm-2 10h6l2 3h4l2-3h6",
  star: "m12 3 3 6 6.5 1-4.75 4.5L18 21l-6-3-6 3 1.25-6.5L2.5 10 6 9Z",
  block: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM5.5 5.5l13 13",
  profile: "M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  request:
    "M14 21v-2a5 5 0 0 0-5-5H7a5 5 0 0 0-5 5v2M12 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM19 6v6M16 9h6",
  hash: "M5 9h15M4 15h15M11 3 7 21M17 3l-4 18",
  speaker: "m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14",
  pin: "m8 3 8 0-1 5 4 4v2H5v-2l4-4ZM12 14v8",
  thread: "M4 4h16v12H9l-5 4ZM8 8h8M8 12h5",
  more: "M4 12h.01M12 12h.01M20 12h.01",
  close: "m6 6 12 12M6 18 18 6",
  send: "m22 2-7 20-4-9-9-4ZM22 2 11 13",
  check: "m4 12 5 5L20 6",
  logout: "M9 3H3v18h6M9 12h13m-5-5 5 5-5 5",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  headphones: "M3 14v-2a9 9 0 0 1 18 0v2M3 13h4v8H3ZM17 13h4v8h-4Z",
  camera: "M3 5h12v14H3ZM15 9l6-4v14l-6-4",
  screen: "M2 3h20v14H2ZM12 17v4M7 21h10",
  down: "m6 9 6 6 6-6",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  reply: "M9 4 2 11l7 7M2 11h12a7 7 0 0 1 7 7",
  edit: "m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  link: "m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
} as const;
export type IconName = keyof typeof paths;
const solid: Partial<Record<IconName, string>> = {
  bell: "M10 2a2 2 0 0 1 4 0 7 7 0 0 1 5 6.7v3.1l1.5 1.8a3 3 0 0 1 .5 1.7v.5c0 .7-.4 1.3-1 1.6A21 21 0 0 1 12 19a21 21 0 0 1-8-1.6c-.6-.3-1-.9-1-1.6v-.5c0-.6.2-1.2.5-1.7L5 11.8V8.7A7 7 0 0 1 10 2ZM9 20h6a3 3 0 0 1-6 0Z",
  pin: "m13 .5 10.5 10.5-.5.5a3 3 0 0 1-4.2 0l-3.1 3.1.4 3.5a2 2 0 0 1-.6 1.6l-.7.7a1 1 0 0 1-1.4 0l-9.3-9.3a1 1 0 0 1 0-1.4l.7-.7a2 2 0 0 1 1.6-.6l3.5.4 3.1-3.1a3 3 0 0 1 0-4.2ZM6.5 15 9 17.5 3.5 21.3l-.8-.8Z",
  users:
    "M9.5 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM2 20.5a7.5 7.5 0 0 1 15 0c0 .8-.7 1.5-1.5 1.5h-12c-.8 0-1.5-.7-1.5-1.5ZM14.5 2a3 3 0 0 0-2.6 1.5A5.5 5.5 0 0 1 15 8a3 3 0 0 0-.5-6ZM15.6 9c-.2 1-.5 1.8-1.1 2.5A10 10 0 0 1 19 18h1.5c.8 0 1.5-.7 1.5-1.5A7.5 7.5 0 0 0 15.6 9Z",
  mic: "M12 2a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4ZM5 10a1 1 0 0 1 1 1v1a6 6 0 0 0 12 0v-1a1 1 0 1 1 2 0v1a8 8 0 0 1-7 7.94V22h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.06A8 8 0 0 1 4 12v-1a1 1 0 0 1 1-1Z",
  headphones:
    "M12 2A10 10 0 0 0 2 12v6a4 4 0 0 0 4 4h1a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H4a8 8 0 1 1 16 0h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1a4 4 0 0 0 4-4v-6A10 10 0 0 0 12 2Z",
  camera:
    "M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2ZM19 9l3-3a1 1 0 0 1 2 1v10a1 1 0 0 1-2 1l-3-3Z",
  screen:
    "M3 3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7v2H7a1 1 0 0 0 0 2h10a1 1 0 0 0 0-2h-3v-2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM3 5h18v12H3Z",
  profile:
    "M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM3 21a9 9 0 0 1 18 0 1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z",
  more: "M6 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm8 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  star: "m12 2 3.3 6.7 7.4 1.1-5.4 5.2 1.3 7.4L12 19l-6.6 3.4L6.7 15 1.3 9.8l7.4-1.1Z",
  chat: "M12 2a10 10 0 0 0-8 16l-1 4 4.7-1.1A10 10 0 1 0 12 2ZM7 8h10v2H7Zm0 5h7v2H7Z",
  inbox:
    "M4 2a2 2 0 0 0-2 2L0 15v5a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2v-5L22 4a2 2 0 0 0-2-2ZM4 4h16l2 11h-6l-2 3h-4l-2-3H2Z",
  phone:
    "M2 14a15 15 0 0 1 20 0 2 2 0 0 1 .6 1.4v3a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V16a13 13 0 0 0-9.2 0v2.4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-3A2 2 0 0 1 2 14Z",
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const filled = solid[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d={filled ?? paths[name]} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}
