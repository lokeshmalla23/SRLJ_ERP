import { forwardRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";

const Calendar = forwardRef(({ className, selected, onSelect, mode = "single", ...props }, ref) => {
  const [month, setMonth] = useState(selected ?? new Date());
  const start = startOfWeek(startOfMonth(month));
  const end = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start, end });
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div ref={ref} className={cn("p-3 select-none", className)} {...props}>
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={() => setMonth(subMonths(month, 1))} className="p-1 rounded hover:bg-gray-100">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium">{format(month, "MMMM yyyy")}</span>
        <button type="button" onClick={() => setMonth(addMonths(month, 1))} className="p-1 rounded hover:bg-gray-100">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-2">
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d) => (
          <div key={d} className="text-center text-xs font-medium text-[#737373] py-1">{d}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 gap-1">
          {week.map((day) => {
            const isSelected = selected && isSameDay(day, selected);
            const isCurrentMonth = isSameMonth(day, month);
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => onSelect?.(day)}
                className={cn(
                  "h-8 w-8 rounded-md text-xs flex items-center justify-center transition-colors mx-auto",
                  isSelected ? "bg-[#0a0a0a] text-white" : "hover:bg-gray-100",
                  !isCurrentMonth && "text-[#a3a3a3]"
                )}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
});
Calendar.displayName = "Calendar";

export { Calendar };
export default Calendar;
