import { Inbox } from "lucide-react";

export default function EmptyState({ title, description, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-start p-10 border border-dashed border-[#E5E7EB] rounded-lg bg-[#FAFAFA]">
      <div className="h-10 w-10 rounded-md bg-white border border-[#E5E7EB] flex items-center justify-center mb-4">
        <Icon size={18} strokeWidth={1.5} className="text-[#737373]" />
      </div>
      <div className="font-display text-[16px] font-medium text-[#0A0A0A]">{title}</div>
      {description && <div className="text-[13px] text-[#737373] mt-1 max-w-md">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
