import { Cake, Heart } from "lucide-react";
import SubReportTable from "./SubReportTable";
import { fmtDate, fmtCustomerCode } from "@/lib/format";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function realMonth() {
  return new Date().getMonth() + 1;
}

function TodayBadge() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-[#D6C28C] bg-[#F5EBD4] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#765A20]">
      Today
    </span>
  );
}

export default function OccasionReportTable({ kind = "birthday" }) {
  const month = realMonth();
  const isAnniversary = kind === "anniversary";
  const dateKey = isAnniversary ? "anniversary" : "dob";
  const title = isAnniversary ? "Anniversary Report" : "Birthday Report";
  const Icon = isAnniversary ? Heart : Cake;
  const todayTitle = isAnniversary ? "Today's anniversaries" : "Today's birthdays";

  return (
    <SubReportTable
      title={title}
      description={`${MONTH_NAMES[month]} — this calendar month. Today's matches are pinned at the top.`}
      endpoint={isAnniversary ? "/reports/customers/anniversary" : "/reports/customers/birthday"}
      params={{ month }}
      emptyMessage={`No ${isAnniversary ? "anniversaries" : "birthdays"} this month.`}
      extra={(rows) => {
        const todayRows = (rows || []).filter((r) => r.is_today);
        if (!todayRows.length) return null;
        return (
          <div className="mb-4 rounded-xl border border-[#DDD7CA] bg-[#FBF8F1] p-4 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#765A20]">
              <Icon size={14} strokeWidth={1.75} />
              {todayTitle}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {todayRows.map((row) => (
                <div
                  key={row.id || `${row.mobile}-${row[dateKey]}`}
                  className="rounded-[9px] border border-[#DDD7CA] bg-[#FFFDF9] px-3 py-2.5"
                >
                  <div className="text-[13px] font-semibold text-[#0A0A0A]">
                    {row.name || "—"}
                    <TodayBadge />
                  </div>
                  <div className="mt-0.5 text-[12px] text-[#525252]">
                    {row.mobile || "—"} · {fmtDate(row[dateKey])}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }}
      columns={[
        {
          key: "id",
          label: "Customer ID",
          forceShow: true,
          render: (r) => <span className="font-mono text-[11px] text-[#737373]">{fmtCustomerCode(r.serial_no)}</span>,
        },
        {
          key: "name",
          label: "Customer",
          render: (r) => (
            <span className="font-medium">
              {r.name || "—"}
              {r.is_today ? <TodayBadge /> : null}
            </span>
          ),
        },
        { key: "mobile", label: "Mobile" },
        { key: dateKey, label: isAnniversary ? "Anniversary" : "Date of Birth", format: "date", render: (r) => fmtDate(r[dateKey]) },
      ]}
      rowClassName={(row) => (row.is_today ? "!bg-[#FDFBF7] font-medium" : "")}
    />
  );
}
