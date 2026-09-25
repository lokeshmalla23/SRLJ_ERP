import {
  Layers, Store, PlusCircle, AlertOctagon, Zap, Clock, History, Route, ListOrdered, ClipboardCheck, Receipt,
} from "lucide-react";

export const QUICK_REPORTS = [
  { key: "stock-details", label: "Stock Details", description: "Per-item detail report grouped by category", icon: ListOrdered },
  { key: "stock-check", label: "Stock Check", description: "Physical verification checklist", icon: ClipboardCheck },
  { key: "category-stock", label: "Category Stock", description: "Category-wise stock summary", icon: Layers },
  { key: "counter-stock", label: "Counter Stock", description: "Counter-wise stock availability", icon: Store },
  { key: "today-stock-added", label: "Today's Stock Added", description: "New tags entered today", icon: PlusCircle },
  { key: "dead-stock", label: "Dead Stock", description: "Items unsold for a long time", icon: AlertOctagon },
  { key: "fast-moving", label: "Fast Moving Stock", description: "Top selling products", icon: Zap },
  { key: "stock-ageing", label: "Stock Ageing", description: "Inventory ageing analysis", icon: Clock },
  { key: "tag-history", label: "Tag History", description: "Complete audit history of every tag", icon: History },
  { key: "item-movement", label: "Item Movement", description: "Track the lifecycle of a jewellery item", icon: Route },
  { key: "sold-items", label: "Sold Stock Info", description: "Line-item detail of every tag sold", icon: Receipt },
];

export default function QuickReportsGrid({ onSelect }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-[#0A0A0A] mb-3">Quick Reports</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        {QUICK_REPORTS.map(({ key, label, description, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className="card text-left hover:border-[#B49042] hover:shadow-md transition-all group"
          >
            <div className="h-9 w-9 rounded-md bg-[#FDFBF7] border border-[#EADFBF] flex items-center justify-center mb-3 group-hover:bg-[#B49042]">
              <Icon size={16} strokeWidth={1.5} className="text-[#B49042] group-hover:text-white" />
            </div>
            <div className="text-[13px] font-semibold text-[#0A0A0A]">{label}</div>
            <div className="text-[11.5px] text-[#737373] mt-0.5">{description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
