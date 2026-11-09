import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import "./select-field.css";

export function selectLabelMotion(contentWidth: number, availableWidth: number) {
  const overflow =
    Number.isFinite(contentWidth) && Number.isFinite(availableWidth)
      ? Math.max(0, Math.round(contentWidth) - Math.round(availableWidth))
      : 0;
  return { overflow, duration: Math.max(2, overflow / 40) };
}

export function SelectLabel({ text, active }: { text: string; active: boolean }) {
  const container = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [motion, setMotion] = useState({ overflow: 0, duration: 2 });
  useLayoutEffect(() => {
    const holder = container.current;
    const label = content.current;
    if (!holder || !label) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const next = selectLabelMotion(label.scrollWidth, holder.clientWidth);
      setMotion((old) => (old.overflow === next.overflow ? old : next));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(holder);
    window.addEventListener("resize", measure);
    document.fonts?.addEventListener("loadingdone", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      alive = false;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [text]);
  return (
    <span
      ref={container}
      className="select-label"
      data-active={active || undefined}
      data-overflow={motion.overflow > 0 || undefined}
      style={
        {
          "--select-label-overflow": `${motion.overflow}px`,
          "--select-label-duration": `${motion.duration}s`,
        } as CSSProperties
      }
    >
      <span ref={content} className="select-label-text">
        {text}
      </span>
    </span>
  );
}
