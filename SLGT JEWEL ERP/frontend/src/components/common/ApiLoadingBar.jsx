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
    <>
      <style>{`
        @keyframes api-loading-shimmer {
          0% { opacity: 0; transform: translateX(-125%); }
          24% { opacity: 0.8; }
          72% { opacity: 0.8; }
          100% { opacity: 0; transform: translateX(525%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .api-loading-shimmer {
            animation: none !important;
            opacity: 0.35;
            transform: translateX(250%);
          }
        }
      `}</style>
      <div
        className="pointer-events-none fixed left-0 right-0 top-0 z-[9999] h-[2px] overflow-hidden bg-[#173F32]/10"
        style={{ opacity: fading ? 0 : 1, transition: "opacity 0.3s ease" }}
      >
        <div
          className="relative h-full overflow-hidden rounded-r-full bg-gradient-to-r from-[#173F32] via-[#2D624E] to-[#173F32]"
          style={{
            width: `${width}%`,
            transition: width === 100 ? "width 0.15s ease" : "width 1.2s ease",
            boxShadow: "0 1px 8px rgba(23, 63, 50, 0.28), 0 0 5px rgba(180, 144, 66, 0.24)",
          }}
        >
          <span
            className="api-loading-shimmer absolute left-0 top-0 h-full w-[24%] bg-gradient-to-r from-transparent via-[#E4D19D] to-transparent"
            style={{ animation: "api-loading-shimmer 1.35s ease-in-out infinite" }}
          />
        </div>
      </div>
    </>
  );
}
