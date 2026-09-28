import { fmtDate, fmtWeight } from "@/lib/format";

/**
 * Purity-wise Gold / Silver sold-weight tables shown at the bottom of every
 * Sales report. Driven by the shared `metal_summary` field each Sales endpoint
 * already returns (computed via metalPurityBreakdown — the same classifier the
 * Dashboard gold cards use).
 *
 * `metals` may be a plain array (Sales reports — gold/silver only) or an object
 * `{ metals, pure_metal, metal_types }` (Accounts → Sales Accounts, which also
 * breaks pure-metal lines out separately and lists every metal type sold).
 */
export default function MetalSummaryTables({ metals, from, to }) {
  const isObject = Boolean(metals) && !Array.isArray(metals);
  const list = isObject ? (metals.metals || []) : (Array.isArray(metals) ? metals : []);
  const pureMetal = isObject ? (metals.pure_metal || []) : [];
  const metalTypes = isObject ? (metals.metal_types || []) : [];
  const gold = list.find((m) => m.metal === "Gold");
  const silver = list.find((m) => m.metal === "Silver");
  const hasAny = Boolean(gold || silver || pureMetal.length || metalTypes.length);

  return (
    <div className="mt-6">
      <div className="mb-2 text-[11.5px] font-medium text-[#737373]">
        From : {fmtDate(from)} &nbsp;TO Date: {fmtDate(to)}
      </div>
      {!hasAny ? (
        <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] px-4 py-6 text-center text-[12.5px] text-[#747B76]">
          No metal sold in this period.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PurityTable title="Gold" accent="#B08A3A" metal={gold} emptyText="No gold sold" />
            <PurityTable title="Silver" accent="#7D8882" metal={silver} emptyText="No silver sold" />
          </div>
          {pureMetal.length > 0 ? (
            <div className="mt-4">
              <PurityTable title="Pure Metal" accent="#3D6B5B" rows={pureMetal} emptyText="" />
            </div>
          ) : null}
          {metalTypes.length > 0 ? (
            <div className="mt-4">
              <MetalTypesTable rows={metalTypes} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function PurityTable({ title, accent, metal, rows: rowsProp, emptyText }) {
  const rows = rowsProp || metal?.rows || [];
  return (
    <div className="overflow-hidden rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]">
      <div
        className="border-b border-[#E6E1D7] px-4 py-2.5 text-[12px] font-semibold text-[#24332B]"
        style={{ borderTop: `2px solid ${accent}` }}
      >
        {title}
      </div>
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="border-b border-[#E6E1D7] bg-[#FAFAFA]">
            <th className="px-3 py-1.5 text-left font-semibold text-[#737373]">Purity</th>
            <th className="px-3 py-1.5 text-right font-semibold text-[#737373]">G.W</th>
            <th className="px-3 py-1.5 text-right font-semibold text-[#737373]">N.W</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F5F5F5]">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-4 text-center text-[#a3a3a3]">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.purity}>
                <td className="px-3 py-1.5 font-medium text-[#0A0A0A]">{r.purity}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-[#525252]">
                  {fmtWeight(r.gross_weight)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-[#0A0A0A]">
                  {fmtWeight(r.net_weight)}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-[#E6E1D7] bg-[#FAFAFA]">
            <td className="px-3 py-1.5 font-semibold text-[#737373]">Total</td>
            <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[#525252]">
              {fmtWeight(metal ? metal.total_gross_weight : rows.reduce((s, r) => s + (Number(r.gross_weight) || 0), 0))}
            </td>
            <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[#0A0A0A]">
              {fmtWeight(metal ? metal.total_net_weight : rows.reduce((s, r) => s + (Number(r.net_weight) || 0), 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MetalTypesTable({ rows }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]">
      <div
        className="border-b border-[#E6E1D7] px-4 py-2.5 text-[12px] font-semibold text-[#24332B]"
        style={{ borderTop: "2px solid #315C4A" }}
      >
        Metal Types Sold
      </div>
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="border-b border-[#E6E1D7] bg-[#FAFAFA]">
            <th className="px-3 py-1.5 text-left font-semibold text-[#737373]">Metal Type</th>
            <th className="px-3 py-1.5 text-right font-semibold text-[#737373]">G.W</th>
            <th className="px-3 py-1.5 text-right font-semibold text-[#737373]">N.W</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F5F5F5]">
          {rows.map((r) => (
            <tr key={r.metal_type}>
              <td className="px-3 py-1.5 font-medium text-[#0A0A0A]">{r.metal_type}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-[#525252]">
                {fmtWeight(r.gross_weight)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-[#0A0A0A]">
                {fmtWeight(r.net_weight)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[#E6E1D7] bg-[#FAFAFA]">
            <td className="px-3 py-1.5 font-semibold text-[#737373]">Total</td>
            <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[#525252]">
              {fmtWeight(rows.reduce((s, r) => s + (Number(r.gross_weight) || 0), 0))}
            </td>
            <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-[#0A0A0A]">
              {fmtWeight(rows.reduce((s, r) => s + (Number(r.net_weight) || 0), 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
