import { Inbox } from "lucide-react";

export default function EmptyState({ title, description, action, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-start rounded-[14px] border border-dashed border-[#E2E7E2] bg-[#FBFAF6] p-10">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-[#D9C48C] bg-white">
        <Icon size={18} strokeWidth={1.5} className="text-[#214F3A]" />
      </div>
      <div className="font-display text-[16px] font-semibold leading-tight tracking-[-0.01em] text-[#17201C]">{title}</div>
      {description && <div className="mt-1.5 max-w-md text-[13px] leading-relaxed text-[#6B756F]">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
