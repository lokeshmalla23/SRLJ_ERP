import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { colors, typography } from "@/lib/theme";

/** Forest-led categorical palette with restrained champagne and silver accents. */
export const CHART_COLORS = [
  colors.forest,
  colors.champagne,
  colors.slate,
  colors.forestDark,
  colors.goldMuted,
  "#A9B7AE",
  "#4D6B5B",
  "#C6D2CA",
];

const AXIS_TICK = {
  fill: colors.muted,
  fontFamily: typography.fontBody,
  fontSize: 10,
};

const tipStyle = {
  background: colors.cream,
  border: `1px solid ${colors.border}`,
  borderRadius: 12,
  boxShadow: "0 12px 32px rgba(23, 56, 42, 0.11)",
  color: colors.ink,
  fontFamily: typography.fontBody,
  fontSize: 12,
  padding: "10px 12px",
};

const tooltipLabelStyle = {
  color: colors.ink,
  fontFamily: typography.fontBody,
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 4,
};

const tooltipItemStyle = {
  color: colors.muted,
  fontFamily: typography.fontBody,
  fontSize: 12,
};

const legendStyle = {
  color: colors.muted,
  fontFamily: typography.fontBody,
  fontSize: 11,
  paddingTop: 8,
};

export function SimplePieChart({
  data,
  dataKey = "value",
  nameKey = "name",
  height = 220,
  innerRadius = 48,
  onSliceClick,
}) {
  const rows = (data || []).filter((d) => Number(d[dataKey]) > 0);
  if (!rows.length) {
    return (
      <div className="chart-empty-state text-[12px]" style={{ height }}>
        No chart data
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={rows}
          dataKey={dataKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={Math.min(80, height / 2 - 20)}
          paddingAngle={2}
          cursor={onSliceClick ? "pointer" : undefined}
          onClick={(entry) => {
            if (!onSliceClick) return;
            const name = entry?.payload?.[nameKey] ?? entry?.[nameKey] ?? entry?.name;
            if (name) onSliceClick(name, entry?.payload || entry);
          }}
        >
          {rows.map((_, i) => (
            <Cell
              key={i}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              stroke={colors.cream}
              strokeWidth={2}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          cursor={{ fill: colors.silver, fillOpacity: 0.55 }}
          formatter={(v) => Number(v).toLocaleString("en-IN")}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function SimpleBarChart({
  data,
  xKey = "name",
  bars = [{ key: "value", name: "Value", color: colors.forest }],
  height = 220,
}) {
  const rows = data || [];
  if (!rows.length) {
    return (
      <div className="chart-empty-state text-[12px]" style={{ height }}>
        No chart data
      </div>
    );
  }
  const rotateLabels = rows.length > 4 || rows.some((r) => String(r[xKey] || "").length > 10);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: rotateLabels ? 48 : 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 4" stroke={colors.border} />
        <XAxis
          dataKey={xKey}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          interval={0}
          angle={rotateLabels ? -28 : 0}
          textAnchor={rotateLabels ? "end" : "middle"}
          height={rotateLabels ? 56 : 30}
        />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickMargin={8} width={52} />
        <Tooltip
          contentStyle={tipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          cursor={{ fill: colors.silver, fillOpacity: 0.62 }}
          formatter={(v) => Number(v).toLocaleString("en-IN")}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={legendStyle} />
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name || b.key}
            fill={b.color || colors.forest}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
