import { useEffect, useRef, useState } from 'react';

export default function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => setSize((prev) => {
      const next = { width: Math.floor(node.clientWidth), height: Math.floor(node.clientHeight) };
      return prev.width === next.width && prev.height === next.height ? prev : next;
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}
