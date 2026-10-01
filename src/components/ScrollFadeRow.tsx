import { useCallback, useEffect, useRef, useState } from 'react';

/** A single-line, sideways-scrolling row that fades whichever edge has more
 * content hidden beyond it — left once you've scrolled, right while there's
 * more to come — so the first and last items are never faded needlessly. */
export default function ScrollFadeRow({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, children]);

  return (
    <div
      ref={ref}
      className={`${className ?? ''} scroll-fade${fade.left ? ' fade-left' : ''}${fade.right ? ' fade-right' : ''}`}
      onScroll={update}
    >
      {children}
    </div>
  );
}
