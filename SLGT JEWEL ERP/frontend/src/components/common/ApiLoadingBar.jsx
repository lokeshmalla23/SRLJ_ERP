import { useState, useEffect } from "react";

export default function ApiLoadingBar() {
  const [active, setActive] = useState(false);
  const [width, setWidth] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    let growTimer = null;
    let fadeTimer = null;

    const handler = (e) => {
      if (e.detail) {
        setFading(false);
        setActive(true);
        setWidth(20);
        clearTimeout(growTimer);
        growTimer = setTimeout(() => setWidth(75), 100);
      } else {
        setWidth(100);
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => {
          setFading(true);
          setTimeout(() => {
            setActive(false);
            setWidth(0);
            setFading(false);
          }, 300);
        }, 150);
      }
    };

    window.addEventListener("api-loading", handler);
    return () => {
      window.removeEventListener("api-loading", handler);
      clearTimeout(growTimer);
      clearTimeout(fadeTimer);
    };
  }, []);

  if (!active && !fading) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] h-[2px] pointer-events-none"
      style={{ opacity: fading ? 0 : 1, transition: "opacity 0.3s ease" }}
    >
      <div
        className="h-full bg-amber-500"
        style={{
          width: `${width}%`,
          transition: width === 100 ? "width 0.15s ease" : "width 1.2s ease",
          boxShadow: "0 0 6px rgba(245,158,11,0.6)",
        }}
      />
    </div>
  );
}
