import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

export default function ImportProgressModal({ open, title = "Importing inventory", progress, onClose }) {
  if (!open || !progress) return null;
  const { processed = 0, total = 0, percent = 0, created = 0, updated = 0, skipped = 0, errors = [], done = false } = progress;
  const errCount = errors.length;
  const remaining = Math.max(0, total - processed);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[420px] p-6 space-y-4">
        <div className="flex items-center gap-2">
          {done && errCount
            ? <AlertTriangle size={18} className="text-amber-600 shrink-0" />
            : done
              ? <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              : <Loader2 size={18} className="animate-spin text-[#B49042] shrink-0" />}
          <h2 className="text-[15px] font-semibold text-[#0A0A0A]">
            {done ? (errCount ? "Import finished with errors" : "Import complete") : title}
          </h2>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="text-[28px] font-display font-semibold text-[#0A0A0A] tabular-nums leading-none">
              {percent}%
            </span>
            <span className="text-[12.5px] text-[#737373] tabular-nums">
              {processed.toLocaleString()} of {total.toLocaleString()} items
            </span>
          </div>
          <div className="h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${done && errCount ? "bg-amber-500" : "bg-[#B49042]"}`}
              style={{ width: `${Math.max(done ? 100 : 2, percent)}%` }}
            />
          </div>
        </div>

        <div className="text-[12.5px] text-[#525252] space-y-1">
          <div>
            {created ? `${created} added` : "0 added"}
            {updated ? ` · ${updated} updated` : ""}
            {skipped ? ` · ${skipped} skipped` : ""}
          </div>
          {!done && remaining > 0 && (
            <div className="text-[#737373]">
              {remaining.toLocaleString()} remaining — keep this window open.
            </div>
          )}
          {done && errCount > 0 && (
            <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded text-[12px] text-amber-800 space-y-1 max-h-28 overflow-y-auto">
              {errors.slice(0, 8).map((er, i) => (
                <div key={`${er.row}-${i}`}>Row {er.row}: {er.detail}</div>
              ))}
              {errCount > 8 && <div>…and {errCount - 8} more</div>}
            </div>
          )}
        </div>

        {done ? (
          <div className="flex justify-end pt-1">
            <button type="button" className="btn-primary" onClick={onClose}>Close</button>
          </div>
        ) : (
          <p className="text-[11.5px] text-[#a3a3a3]">Do not refresh or close the app while import is running.</p>
        )}
      </div>
    </div>
  );
}
