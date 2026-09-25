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

/** Neutral gold / ink palette — matches jewellery CRM UI (no purple). */
export const CHART_COLORS = [
  "#B49042",
  "#0A0A0A",
  "#737373",
  "#D4A84B",
  "#525252",
  "#A3A3A3",
  "#8B6914",
  "#404040",
];

const tipStyle = {
  background: "#fff",
  border: "1px solid #E5E7EB",
  borderRadius: 8,
  fontSize: 12,
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
      <div className="flex items-center justify-center text-[12px] text-[#a3a3a3]" style={{ height }}>
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
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tipStyle} formatter={(v) => Number(v).toLocaleString("en-IN")} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function SimpleBarChart({
  data,
  xKey = "name",
  bars = [{ key: "value", name: "Value", color: "#B49042" }],
  height = 220,
}) {
  const rows = data || [];
  if (!rows.length) {
    return (
      <div className="flex items-center justify-center text-[12px] text-[#a3a3a3]" style={{ height }}>
        No chart data
      </div>
    );
  }
  const rotateLabels = rows.length > 4 || rows.some((r) => String(r[xKey] || "").length > 10);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: rotateLabels ? 48 : 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 10, fill: "#737373" }}
          interval={0}
          angle={rotateLabels ? -28 : 0}
          textAnchor={rotateLabels ? "end" : "middle"}
          height={rotateLabels ? 56 : 30}
        />
        <YAxis tick={{ fontSize: 10, fill: "#737373" }} width={52} />
        <Tooltip contentStyle={tipStyle} formatter={(v) => Number(v).toLocaleString("en-IN")} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.name || b.key} fill={b.color || "#B49042"} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
