// ── Decorative jewellery artwork ──────────────────────────────────────────────
// Presentation-only SVG used by the dashboard hero, the live-rate strip and the
// gold / silver summary cards.
//
// Nothing in this file reads app state, renders business values, or handles
// events: every root is aria-hidden + pointer-events-none, so the ERP keeps
// identical data flow, behaviour and accessibility output. The artwork is
// artwork only — no rates, weights or figures are baked into it.

import { useId } from "react";

/**
 * Metallic gradient ramps. Each stop list paints a sheen that wraps the shape,
 * which is what makes flat vector bars/bangles read as polished metal.
 */
const METAL_TOKENS = {
  gold: {
    cap:    [[0, "#FEF8E8"], [0.32, "#F6E2AE"], [0.66, "#E2B75E"], [1, "#C79736"]],
    body:   [[0, "#F0D08A"], [0.3, "#DCA644"], [0.65, "#B9822A"], [1, "#8E6118"]],
    ring:   [[0, "#C79539"], [0.16, "#FCF2D8"], [0.38, "#E3BB70"], [0.6, "#A87A29"], [0.8, "#F1DFAE"], [1, "#BC8C33"]],
    ringAlt:[[0, "#A87A29"], [0.2, "#F0DCAE"], [0.45, "#CE9C3E"], [0.72, "#8E6720"], [1, "#DCB771"]],
    glow:   [[0, "#FBF1D9", 0.95], [0.55, "#F3E2BC", 0.42], [1, "#F3E2BC", 0]],
    shadow: [[0, "#8E6720", 0.3], [1, "#8E6720", 0]],
    spark:  "#EBD59A",
    rim:    "#B98A32",
  },
  silver: {
    cap:    [[0, "#FFFFFF"], [0.35, "#EDF2F5"], [0.7, "#CFD9E0"], [1, "#B2BEC7"]],
    body:   [[0, "#E4ECF0"], [0.3, "#C8D3DA"], [0.65, "#A4B2BC"], [1, "#86949F"]],
    ring:   [[0, "#9FADB8"], [0.18, "#FFFFFF"], [0.4, "#D3DDE4"], [0.62, "#94A3AE"], [0.82, "#E8EFF3"], [1, "#A7B4BE"]],
    ringAlt:[[0, "#8C9AA5"], [0.22, "#EFF4F7"], [0.5, "#BCC7CF"], [0.75, "#7E8C97"], [1, "#D6DEE4"]],
    glow:   [[0, "#EFF4F7", 0.95], [0.55, "#DCE6EC", 0.42], [1, "#DCE6EC", 0]],
    shadow: [[0, "#6E7C87", 0.28], [1, "#6E7C87", 0]],
    spark:  "#DCE6EC",
    rim:    "#8C9AA5",
  },
};

const GEM_STOPS = [[0, "#FFFFFF"], [0.45, "#F6EFD9"], [1, "#DCCB9E"]];

const tokensFor = (metal) => METAL_TOKENS[metal] ?? METAL_TOKENS.gold;

const Stops = ({ list }) => (
  <>
    {list.map(([offset, color, opacity]) => (
      <stop
        key={`${offset}-${color}`}
        offset={offset}
        stopColor={color}
        {...(opacity == null ? {} : { stopOpacity: opacity })}
      />
    ))}
  </>
);

/** Unique, DOM-safe gradient/mask ids so several pieces can coexist. */
function useArtIds() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  return {
    cap:     `jew-cap-${uid}`,
    body:    `jew-body-${uid}`,
    ring:    `jew-ring-${uid}`,
    ringAlt: `jew-ring-alt-${uid}`,
    gem:     `jew-gem-${uid}`,
    glow:    `jew-glow-${uid}`,
    shadow:  `jew-shadow-${uid}`,
    blur:    `jew-blur-${uid}`,
    fadeX:   `jew-fade-x-${uid}`,
    fadeY:   `jew-fade-y-${uid}`,
    mask:    `jew-mask-${uid}`,
  };
}

function MetalDefs({ ids, metal }) {
  const t = tokensFor(metal);
  return (
    <defs>
      <linearGradient id={ids.cap} x1="0" y1="0" x2="0.3" y2="1"><Stops list={t.cap} /></linearGradient>
      <linearGradient id={ids.body} x1="0.05" y1="0" x2="0.85" y2="1"><Stops list={t.body} /></linearGradient>
      <linearGradient id={ids.ring} x1="0" y1="0" x2="1" y2="0.7"><Stops list={t.ring} /></linearGradient>
      <linearGradient id={ids.ringAlt} x1="0.1" y1="0" x2="0.9" y2="0.8"><Stops list={t.ringAlt} /></linearGradient>
      <linearGradient id={ids.gem} x1="0" y1="0" x2="0.6" y2="1"><Stops list={GEM_STOPS} /></linearGradient>
      <radialGradient id={ids.glow} cx="0.5" cy="0.5" r="0.5"><Stops list={t.glow} /></radialGradient>
      <radialGradient id={ids.shadow} cx="0.5" cy="0.5" r="0.5"><Stops list={t.shadow} /></radialGradient>
      <filter id={ids.blur} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      {/* Soft edge fades keep the artwork integrated with the card behind it. */}
      <linearGradient id={ids.fadeX} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#C4C4C4" />
        <stop offset="0.2" stopColor="#FFFFFF" />
        <stop offset="0.9" stopColor="#FFFFFF" />
        <stop offset="1" stopColor="#CECECE" />
      </linearGradient>
      <linearGradient id={ids.fadeY} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#DCDCDC" />
        <stop offset="0.3" stopColor="#FFFFFF" />
        <stop offset="1" stopColor="#A4A4A4" />
      </linearGradient>
      <mask id={ids.mask}>
        <rect width="100%" height="100%" fill={`url(#${ids.fadeX})`} />
        <rect width="100%" height="100%" fill={`url(#${ids.fadeY})`} />
      </mask>
    </defs>
  );
}

function Sparkle({ x, y, size, color, opacity = 0.9 }) {
  const q = size * 0.17;
  return (
    <path
      d={`M ${x} ${y - size} Q ${x + q} ${y - q} ${x + size} ${y} Q ${x + q} ${y + q} ${x} ${y + size} Q ${x - q} ${y + q} ${x - size} ${y} Q ${x - q} ${y - q} ${x} ${y - size} Z`}
      fill={color}
      opacity={opacity}
    />
  );
}

/* ── Hero: bangle stack with a draped chain ─────────────────────────────────── */

function Bangle({ ids, cx, cy, rx, ry, width, rotate = 0, alt = false, gems = [] }) {
  const t = tokensFor("gold");
  const ringId = alt ? ids.ringAlt : ids.ring;
  return (
    <g transform={`rotate(${rotate} ${cx} ${cy})`}>
      {/* ambient shadow under the band */}
      <ellipse
        cx={cx} cy={cy + 8} rx={rx} ry={ry}
        fill="none" stroke={t.shadow[0][1]} strokeOpacity="0.16"
        strokeWidth={width + 8} filter={`url(#${ids.blur})`}
      />
      {/* the band itself */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={`url(#${ringId})`} strokeWidth={width} />
      {/* shaded lower half gives the band depth */}
      <path
        d={`M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`}
        fill="none" stroke={t.shadow[0][1]} strokeOpacity="0.2" strokeWidth={width * 0.5}
      />
      {/* crisp specular highlight along the inner edge */}
      <ellipse
        cx={cx} cy={cy} rx={rx - width * 0.66} ry={ry - width * 0.66}
        fill="none" stroke="#FFFDF3" strokeOpacity="0.5" strokeWidth="1.3"
      />
      {gems.map(([angle, scale]) => {
        const rad = (angle * Math.PI) / 180;
        const gx = cx + rx * Math.cos(rad);
        const gy = cy + ry * Math.sin(rad);
        const s = 7 * scale;
        return (
          <g key={`${angle}-${scale}`}>
            <rect
              x={gx - s} y={gy - s} width={s * 2} height={s * 2}
              transform={`rotate(45 ${gx} ${gy})`}
              fill={`url(#${ids.gem})`} stroke={t.rim} strokeWidth="1" strokeOpacity="0.7"
            />
            <circle cx={gx} cy={gy} r={s * 0.32} fill="#FFFFFF" fillOpacity="0.92" />
          </g>
        );
      })}
    </g>
  );
}

/**
 * Large jewellery visual for the greeting hero: stacked bangles, a draped
 * chain with a pendant, stone accents and a soft cream atmosphere.
 */
export function JewelleryHeroArt({ className = "" }) {
  const ids = useArtIds();
  return (
    <svg
      viewBox="30 14 412 254"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${ids.ring}`} x1="0" y1="0" x2="1" y2="0.7"><Stops list={tokensFor("gold").ring} /></linearGradient>
        <linearGradient id={`${ids.ringAlt}`} x1="0.1" y1="0" x2="0.9" y2="0.8"><Stops list={tokensFor("gold").ringAlt} /></linearGradient>
        <linearGradient id={`${ids.gem}`} x1="0" y1="0" x2="0.6" y2="1"><Stops list={GEM_STOPS} /></linearGradient>
        <radialGradient id={`${ids.glow}`} cx="0.5" cy="0.5" r="0.5"><Stops list={tokensFor("gold").glow} /></radialGradient>
        <radialGradient id={`${ids.shadow}`} cx="0.5" cy="0.5" r="0.5"><Stops list={tokensFor("gold").shadow} /></radialGradient>
        <filter id={`${ids.blur}`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6" /></filter>
        <linearGradient id={`${ids.fadeX}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4A4A4A" />
          <stop offset="0.2" stopColor="#FFFFFF" />
          <stop offset="0.84" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#C8C8C8" />
        </linearGradient>
        <mask id={`${ids.mask}`}>
          <rect x="30" y="14" width="412" height="254" fill={`url(#${ids.fadeX})`} />
        </mask>
      </defs>

      <g mask={`url(#${ids.mask})`}>
        {/* soft cream atmosphere */}
        <ellipse cx="286" cy="150" rx="196" ry="136" fill={`url(#${ids.glow})`} />
        <ellipse cx="300" cy="238" rx="132" ry="20" fill={`url(#${ids.shadow})`} opacity="0.5" filter={`url(#${ids.blur})`} />

        {/* draped chain + pendant */}
        <g>
          <path
            d="M 78 92 Q 148 196 218 146"
            fill="none" stroke={`url(#${ids.ring})`} strokeWidth="3.4"
            strokeLinecap="round" strokeDasharray="0.5 6.5" opacity="0.9"
          />
          <circle cx="219" cy="150" r="3" fill={`url(#${ids.ring})`} />
          <path
            d="M 219 156 c 9 13 13 21 13 27 a 13 13 0 0 1 -26 0 c 0 -6 4 -14 13 -27 Z"
            fill={`url(#${ids.gem})`} stroke="#B98A32" strokeWidth="1.2" strokeOpacity="0.75"
          />
          <circle cx="219" cy="176" r="4.4" fill="#FFFFFF" fillOpacity="0.7" />
          <circle cx="66" cy="84" r="3.4" fill={`url(#${ids.ring})`} />
        </g>

        {/* bangle stack */}
        <Bangle ids={ids} cx={306} cy={136} rx={128} ry={94} width={15} rotate={-7} alt />
        <Bangle ids={ids} cx={232} cy={160} rx={108} ry={78} width={13} rotate={9} gems={[[52, 0.85], [96, 1]]} />
        <Bangle ids={ids} cx={338} cy={172} rx={94} ry={68} width={12} rotate={-4} alt gems={[[64, 0.8], [110, 0.72]]} />
        <Bangle ids={ids} cx={268} cy={196} rx={70} ry={50} width={10} rotate={6} />

        {/* jewellery glints */}
        <Sparkle x={382} y={70} size={13} color="#EBD59A" opacity={0.95} />
        <Sparkle x={168} y={196} size={9} color="#F2E3BE" opacity={0.85} />
        <Sparkle x={318} y={226} size={7} color="#EBD59A" opacity={0.7} />
      </g>
    </svg>
  );
}

/* ── Bullion: stacked bars ──────────────────────────────────────────────────── */

function BullionBar({ ids, x, y, w, h, skew = 6, capDepth = 8 }) {
  const top = y + capDepth;
  const bottom = top + h;
  const left = x + skew;
  const right = x + w - skew;
  return (
    <g>
      {/* cap (top face) */}
      <polygon points={`${left},${y} ${right},${y} ${x + w},${top} ${x},${top}`} fill={`url(#${ids.cap})`} />
      {/* body (front face) */}
      <polygon points={`${x},${top} ${x + w},${top} ${right - skew * 0.7},${bottom} ${left + skew * 0.7},${bottom}`} fill={`url(#${ids.body})`} />
      {/* specular sweep across the front face */}
      <polygon
        points={`${x + w * 0.2},${top} ${x + w * 0.4},${top} ${x + w * 0.3},${bottom} ${x + w * 0.1},${bottom}`}
        fill="#FFFFFF" opacity="0.2"
      />
      {/* engraved ridge on the cap */}
      <path d={`M ${left + skew} ${y + capDepth * 0.52} L ${right - skew} ${y + capDepth * 0.52}`} stroke="#8E6720" strokeOpacity="0.22" strokeWidth="0.9" />
      {/* crisp top edge */}
      <path d={`M ${left},${y} L ${right},${y}`} stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="1.1" />
    </g>
  );
}

/**
 * Stacked bullion artwork (gold or silver). Used as the left-hand visual in the
 * live rate strip and as the right-hand artwork inside the metal summary cards.
 */
export function BullionArt({ metal = "gold", className = "" }) {
  const ids = useArtIds();
  return (
    <svg
      viewBox="0 0 170 130"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <MetalDefs ids={ids} metal={metal} />
      <g mask={`url(#${ids.mask})`}>
        <ellipse cx="88" cy="62" rx="80" ry="56" fill={`url(#${ids.glow})`} />
        <ellipse cx="76" cy="119" rx="64" ry="9" fill={`url(#${ids.shadow})`} opacity="0.65" filter={`url(#${ids.blur})`} />
        <BullionBar ids={ids} x={64} y={28} w={78} h={21} skew={6} capDepth={8} />
        <BullionBar ids={ids} x={47} y={54} w={85} h={22} skew={6} capDepth={8} />
        <BullionBar ids={ids} x={29} y={82} w={89} h={24} skew={7} capDepth={9} />
        <Sparkle x={146} y={36} size={9} color={tokensFor(metal).spark} opacity={0.9} />
        <Sparkle x={18} y={70} size={6} color={tokensFor(metal).spark} opacity={0.7} />
      </g>
    </svg>
  );
}

export default JewelleryHeroArt;
