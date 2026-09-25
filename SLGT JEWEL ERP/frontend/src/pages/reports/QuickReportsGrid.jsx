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
      <h3 className="mb-3 text-[13px] font-semibold tracking-[-0.01em] text-[#24332B]">Quick Reports</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        {QUICK_REPORTS.map(({ key, label, description, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className="card group text-left transition-all hover:!border-[#9EB2A6] hover:shadow-[0_10px_26px_rgba(42,71,55,0.09)]"
          >
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-[9px] border border-[#D6E0D8] bg-[#EEF3EF] transition-colors group-hover:border-[#315C4A] group-hover:bg-[#315C4A]">
              <Icon size={16} strokeWidth={1.6} className="text-[#315C4A] group-hover:text-white" />
            </div>
            <div className="text-[13px] font-semibold text-[#24332B]">{label}</div>
            <div className="mt-1 text-[11.5px] leading-4 text-[#737B76]">{description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
