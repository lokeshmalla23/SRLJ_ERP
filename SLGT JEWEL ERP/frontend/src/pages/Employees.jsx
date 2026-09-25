import { useEffect, useState, useMemo } from "react";
import { CardGridSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  Search,
  Plus,
  X,
  User,
  Phone,
  Mail,
  Briefcase,
  Building2,
  Calendar,
  DollarSign,
  MapPin,
  AlertCircle,
  FileText,
  Edit2,
  Trash2,
  Users,
  UserCheck,
  UserX,
  LayoutGrid,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import MoneyInput from "@/components/ui/MoneyInput";
import { fmtINR, fmtDate, parseMoneyInput } from "@/lib/format";
import useConfirm from "@/hooks/useConfirm";
import { useAuth } from "@/context/AuthContext";
import PermissionsTab from "@/components/employees/PermissionsTab";

const DEPT_SUGGESTIONS = [
  "Sales",
  "Accounts",
  "Management",
  "Goldsmith",
  "Security",
  "Housekeeping",
];

const EMPTY_FORM = {
  name: "",
  mobile: "",
  email: "",
  job_title: "",
  department: "",
  salary: "",
  join_date: "",
  status: "active",
  address: "",
  emergency_contact: "",
  notes: "",
};

function getInitials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const AVATAR_COLORS = [
  "bg-[#E7EFE8] text-[#315E48]",
  "bg-[#EEF1E8] text-[#526B57]",
  "bg-[#F5EEDC] text-[#8A6D2F]",
  "bg-[#E8EEF0] text-[#4E6570]",
  "bg-[#F1E8E1] text-[#8A5A43]",
  "bg-[#E9ECE3] text-[#5E684E]",
  "bg-[#E4EEE9] text-[#3F6A5A]",
  "bg-[#F0EAE3] text-[#795E4B]",
];

function avatarColor(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color = "text-[#294236]" }) {
  return (
    <div className="relative flex items-center gap-3.5 overflow-hidden rounded-[10px] border border-[#DCE3D6] bg-[#FEFEFB] p-4 shadow-[0_1px_2px_rgba(36,55,45,0.04)] before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-[#B49042]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] border border-[#D3DDD1] bg-[#EDF2EA] text-[#315E48]">
        <Icon size={18} strokeWidth={1.7} />
      </div>
      <div>
        <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#77847A]">{label}</p>
        <p className={`font-display text-[22px] font-semibold leading-tight ${color}`}>{value ?? "—"}</p>
      </div>
    </div>
  );
}

// ─── Employee Card ─────────────────────────────────────────────────────────────
function EmployeeCard({ emp, onClick }) {
  const initials = getInitials(emp.name);
  const colorClass = avatarColor(emp.name);
  const isActive = emp.status === "active";

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-[10px] border border-[#DCE3D6] bg-[#FEFEFB] p-5 shadow-[0_1px_2px_rgba(36,55,45,0.04)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[#AFC1AD] hover:shadow-[0_8px_22px_rgba(36,55,45,0.08)]"
    >
      <div className="flex items-start gap-3 mb-4">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center text-[15px] font-semibold shrink-0 ${colorClass}`}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[#294236] truncate">{emp.name}</p>
          <p className="text-[12px] text-[#737373] truncate">{emp.job_title || "—"}</p>
        </div>
        <span
          className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${
            isActive
              ? "border border-[#C8D8C6] bg-[#EAF1E8] text-[#315E48]"
              : "border border-[#E8CBC5] bg-[#FFF3F1] text-[#A34A42]"
          }`}
        >
          {isActive ? "Active" : "Inactive"}
        </span>
      </div>

      <div className="space-y-1.5">
        {emp.department && (
          <div className="flex items-center gap-2 text-[12px] text-[#525252]">
            <Building2 size={12} strokeWidth={1.5} className="text-[#a3a3a3] shrink-0" />
            <span className="truncate">{emp.department}</span>
          </div>
        )}
        {emp.mobile && (
          <div className="flex items-center gap-2 text-[12px] text-[#525252]">
            <Phone size={12} strokeWidth={1.5} className="text-[#a3a3a3] shrink-0" />
            <span className="truncate">{emp.mobile}</span>
          </div>
        )}
        {emp.join_date && (
          <div className="flex items-center gap-2 text-[12px] text-[#525252]">
            <Calendar size={12} strokeWidth={1.5} className="text-[#a3a3a3] shrink-0" />
            <span>Joined {fmtDate(emp.join_date)}</span>
          </div>
        )}
        {emp.salary != null && emp.salary !== "" && (
          <div className="flex items-center gap-2 text-[12px] text-[#525252]">
            <DollarSign size={12} strokeWidth={1.5} className="text-[#a3a3a3] shrink-0" />
            <span>{fmtINR(emp.salary)} / mo</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Detail Panel ──────────────────────────────────────────────────────────────
function DetailPanel({ emp, onClose, onEdit, onDelete }) {
  if (!emp) return null;
  const initials = getInitials(emp.name);
  const colorClass = avatarColor(emp.name);
  const isActive = emp.status === "active";

  const row = (icon, label, value) => {
    if (!value && value !== 0) return null;
    const Icon = icon;
    return (
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#DCE3D6] bg-[#F2F5EF]">
          <Icon size={14} strokeWidth={1.5} className="text-[#737373]" />
        </div>
        <div>
          <p className="text-[11px] text-[#737373] font-medium uppercase tracking-wide">{label}</p>
          <p className="text-[13px] text-[#294236]">{value}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[#1A261F]/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[#D4DDD1] bg-[#FEFEFB] shadow-[-18px_0_50px_rgba(27,43,34,0.16)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#DCE3D6] bg-[#F3F5EE]/95 px-6 py-4 backdrop-blur-sm">
          <h2 className="font-display text-[15px] font-semibold text-[#294236]">Employee Details</h2>
          <button onClick={onClose} className="rounded-[8px] p-1.5 text-[#748078] transition-colors hover:bg-white hover:text-[#294236] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35">
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>

        {/* Profile */}
        <div className="flex items-center gap-4 border-b border-[#DCE3D6] bg-[#F0F4EC] px-6 py-6">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center text-[20px] font-bold shrink-0 ${colorClass}`}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-[18px] font-semibold text-[#294236]">{emp.name}</p>
            <p className="text-[13px] text-[#737373]">{emp.job_title || "No title"}</p>
            <span
              className={`mt-1 inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${
                isActive
                  ? "border border-[#C8D8C6] bg-[#EAF1E8] text-[#315E48]"
                  : "border border-[#E8CBC5] bg-[#FFF3F1] text-[#A34A42]"
              }`}
            >
              {isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="px-6 py-6 space-y-4 flex-1">
          {row(Building2, "Department", emp.department)}
          {row(Phone, "Mobile", emp.mobile)}
          {row(Mail, "Email", emp.email)}
          {row(Calendar, "Join Date", emp.join_date ? fmtDate(emp.join_date) : null)}
          {row(DollarSign, "Salary", emp.salary != null && emp.salary !== "" ? `${fmtINR(emp.salary)} / month` : null)}
          {row(MapPin, "Address", emp.address)}
          {row(AlertCircle, "Emergency Contact", emp.emergency_contact)}
          {row(FileText, "Notes", emp.notes)}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-[#DCE3D6] flex items-center gap-2">
          <button
            onClick={onEdit}
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#244B39] bg-[#244B39] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#173D2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315E48]/30 focus-visible:ring-offset-2"
          >
            <Edit2 size={13} strokeWidth={1.5} />
            Edit
          </button>
          <button
            onClick={onDelete}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#E5C8C2] bg-white px-4 text-[12.5px] font-semibold text-[#A34A42] transition-colors hover:border-[#D39D91] hover:bg-[#FFF3F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B6534D]/25"
          >
            <Trash2 size={13} strokeWidth={1.5} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add/Edit Modal ────────────────────────────────────────────────────────────
function EmployeeModal({ emp, onClose, onSaved }) {
  const isEdit = Boolean(emp?.id);
  const [form, setForm] = useState(
    isEdit
      ? {
          name: emp.name ?? "",
          mobile: emp.mobile ?? "",
          email: emp.email ?? "",
          job_title: emp.job_title ?? "",
          department: emp.department ?? "",
          salary: emp.salary ?? "",
          join_date: emp.join_date ?? "",
          status: emp.status ?? "active",
          address: emp.address ?? "",
          emergency_contact: emp.emergency_contact ?? "",
          notes: emp.notes ?? "",
        }
      : { ...EMPTY_FORM }
  );
  const [busy, setBusy] = useState(false);
  const [createLogin, setCreateLogin] = useState(!isEdit);
  const [loginRole, setLoginRole] = useState("sales_executive");
  const [loginPassword, setLoginPassword] = useState("");
  // null = not checked, false = no conflict, { orphan: true } = user exists but no employee, { linked: true } = already an employee
  const [emailStatus, setEmailStatus] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const checkEmailExists = async (email) => {
    if (!email.trim() || isEdit) return;
    try {
      const { data: users } = await api.get(`/users?email=${encodeURIComponent(email.trim())}`);
      if (!Array.isArray(users) || users.length === 0) { setEmailStatus(false); return; }
      const user = users[0];
      // Check if this user is already linked to an active employee
      const { data: emps } = await api.get(`/employees?search=${encodeURIComponent(email.trim())}`);
      const linked = Array.isArray(emps) && emps.some((e) => e.user_id === user.id);
      setEmailStatus(linked ? { linked: true } : { orphan: true, userId: user.id });
    } catch {
      setEmailStatus(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    if (!form.mobile.trim()) return toast.error("Mobile is required");
    if (!isEdit && createLogin) {
      if (!form.email.trim()) return toast.error("Email is required to create a login account");
      if (!loginPassword.trim()) return toast.error("Password is required for login account");
      if (emailStatus?.linked) return toast.error("This email is already linked to another employee");
    }
    setBusy(true);
    try {
      const payload = {
        ...form,
        salary: form.salary === "" ? null : parseMoneyInput(form.salary),
        join_date: form.join_date || null,
      };
      if (isEdit) {
        await api.put(`/employees/${emp.id}`, payload);
        toast.success("Employee updated");
      } else {
        let createdUser = null;
        // Create login first so password is saved before employee row
        if (createLogin && form.email.trim()) {
          try {
            const { data } = await api.post("/users", {
              email: form.email.trim(),
              name: form.name.trim(),
              password: loginPassword,
              role: loginRole,
            });
            createdUser = data;
          } catch (userErr) {
            const errData = userErr?.response?.data;
            if (userErr?.response?.status === 409 && errData?.existing_id) {
              // Email already has login access — link employee to existing account
              createdUser = { id: errData.existing_id };
              toast.info("Email already has login access — employee linked to existing account");
            } else {
              toast.error(
                "Login account failed: "
                + (errData?.detail || userErr.message || "could not save password"),
              );
              setBusy(false);
              return;
            }
          }
        }

        const { data: emp } = await api.post("/employees", {
          ...payload,
          user_id: createdUser?.id || null,
        });

        // Ensure employee is linked to the login user
        if (createdUser?.id && emp?.id) {
          try {
            await api.put(`/employees/${emp.id}`, { ...payload, user_id: createdUser.id });
          } catch { /* non-fatal */ }
        }

        toast.success(createdUser ? "Employee and login account created" : "Employee added");
      }
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const labelClass = "mb-1 block text-[11px] font-semibold text-[#5F6F63]";
  const inputClass =
    "w-full rounded-[9px] border border-[#C8D2C5] bg-white px-3 py-2 text-[12.5px] text-[#294236] placeholder-[#9AA39B] transition-colors focus:border-[#5F7D67] focus:outline-none focus:ring-2 focus:ring-[#DCE7D8] disabled:bg-[#F1F2ED]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A261F]/45 px-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[10px] border border-[#D4DDD1] bg-[#FEFEFB] shadow-[0_24px_60px_rgba(27,43,34,0.24)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#DCE3D6] bg-[#F3F5EE]/95 px-6 py-4 backdrop-blur-sm">
          <h2 className="font-display text-[15px] font-semibold text-[#294236]">
            {isEdit ? "Edit Employee" : "Add Employee"}
          </h2>
          <button onClick={onClose} className="rounded-[8px] p-1.5 text-[#748078] transition-colors hover:bg-white hover:text-[#294236] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35">
            <X size={18} strokeWidth={1.7} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-5">
          {/* Row 1: Name + Mobile */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>
                Name <span className="text-red-500">*</span>
              </label>
              <input
                className={inputClass}
                placeholder="Full name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>
                Mobile <span className="text-red-500">*</span>
              </label>
              <input
                className={inputClass}
                placeholder="10-digit number"
                value={form.mobile}
                onChange={(e) => set("mobile", e.target.value)}
              />
            </div>
          </div>

          {/* Row 2: Email */}
          <div>
            <label className={labelClass}>Email</label>
            <input
              className={inputClass}
              type="email"
              placeholder="employee@example.com"
              value={form.email}
              onChange={(e) => { set("email", e.target.value); setEmailStatus(null); }}
              onBlur={(e) => createLogin && checkEmailExists(e.target.value)}
            />
            {emailStatus?.orphan && createLogin && !isEdit && (
              <p className="mt-1 text-[11.5px] text-amber-600">
                A login account exists for this email (no employee linked). The new employee will be connected to it automatically.
              </p>
            )}
            {emailStatus?.linked && createLogin && !isEdit && (
              <p className="mt-1 text-[11.5px] text-red-500">
                This email is already linked to another employee. Use a different email or disable Login Account.
              </p>
            )}
          </div>

          {/* Row 3: Job Title + Department */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Job Title</label>
              <input
                className={inputClass}
                placeholder="e.g. Senior Sales Rep"
                value={form.job_title}
                onChange={(e) => set("job_title", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Department</label>
              <select
                className={inputClass}
                value={form.department}
                onChange={(e) => set("department", e.target.value)}
              >
                <option value="">— Select department —</option>
                {DEPT_SUGGESTIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 4: Salary + Join Date */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Salary (₹ / month)</label>
              <MoneyInput
                className={inputClass}
                min="0"
                placeholder="0"
                value={form.salary}
                onValueChange={(raw) => set("salary", raw)}
              />
            </div>
            <div>
              <label className={labelClass}>Join Date</label>
              <input
                className={inputClass}
                type="date"
                value={form.join_date}
                onChange={(e) => set("join_date", e.target.value)}
              />
            </div>
          </div>

          {/* Row 5: Status */}
          <div>
            <label className={labelClass}>Status</label>
            <div className="flex gap-3">
              {["active", "inactive"].map((s) => (
                <label
                  key={s}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer text-[13px] font-medium transition-colors ${
                    form.status === s
                      ? s === "active"
                        ? "border-[#8FAA90] bg-[#EAF1E8] text-[#315E48]"
                        : "border-[#DCA69B] bg-[#FFF3F1] text-[#A34A42]"
                      : "border-[#DCE3D6] bg-white text-[#6B786F] hover:border-[#B8C5B6] hover:bg-[#F8F9F5]"
                  }`}
                >
                  <input
                    type="radio"
                    name="status"
                    value={s}
                    checked={form.status === s}
                    onChange={() => set("status", s)}
                    className="sr-only"
                  />
                  {s === "active" ? (
                    <UserCheck size={13} strokeWidth={1.5} />
                  ) : (
                    <UserX size={13} strokeWidth={1.5} />
                  )}
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {/* Row 6: Address */}
          <div>
            <label className={labelClass}>Address</label>
            <textarea
              className={`${inputClass} resize-none`}
              rows={2}
              placeholder="Full address"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </div>

          {/* Row 7: Emergency Contact */}
          <div>
            <label className={labelClass}>Emergency Contact</label>
            <input
              className={inputClass}
              placeholder="Name and phone number"
              value={form.emergency_contact}
              onChange={(e) => set("emergency_contact", e.target.value)}
            />
          </div>

          {/* Row 8: Notes */}
          <div>
            <label className={labelClass}>Notes</label>
            <textarea
              className={`${inputClass} resize-none`}
              rows={2}
              placeholder="Any additional notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          {/* Login Account */}
          {!isEdit && (
            <div className="space-y-4 rounded-[10px] border border-[#DCE3D6] bg-[#F5F7F1] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-[#294236]">Login Account</div>
                  <div className="text-[11.5px] text-[#737373] mt-0.5">Create system access for this employee</div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    onClick={() => setCreateLogin((v) => !v)}
                    className={`relative h-5 w-10 rounded-full transition-colors ${createLogin ? "bg-[#244B39]" : "bg-[#D5DBD2]"}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${createLogin ? "translate-x-5" : "translate-x-0.5"}`} />
                  </div>
                </label>
              </div>

              {createLogin && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Role</label>
                    <select
                      className={inputClass}
                      value={loginRole}
                      onChange={(e) => setLoginRole(e.target.value)}
                    >
                      <option value="sales_executive">Sales Executive</option>
                      <option value="manager">Manager</option>
                      <option value="accountant">Accountant</option>
                      <option value="cashier">Cashier</option>
                      <option value="inventory_manager">Inventory Manager</option>
                      <option value="gold_scheme_manager">Gold Scheme Manager</option>
                      <option value="repair_manager">Repair Manager</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Password</label>
                    <input
                      className={inputClass}
                      type="password"
                      placeholder="Set a login password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      autoComplete="new-password"
                      name="ssj-emp-login-password"
                      data-enter-ignore="true"
                      required={createLogin}
                    />
                  </div>
                  <div className="col-span-2">
                    <div className="text-[11.5px] text-[#737373] bg-white border border-[#DCE3D6] rounded-lg px-3 py-2">
                      Login email will be: <span className="font-mono font-medium text-[#294236]">{form.email || "— fill the Email field above —"}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[9px] border border-[#CDD6CA] bg-white px-4 text-[12.5px] font-semibold text-[#526458] transition-colors hover:border-[#9FAF9E] hover:bg-[#F7F9F4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-9 rounded-[9px] border border-[#244B39] bg-[#244B39] px-5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#173D2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315E48]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving…" : isEdit ? "Save Changes" : "Add Employee"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function Employees() {
  const { can } = useAuth();
  const canViewPermissions = can("users", "view");
  const canWritePermissions = can("users", "edit");
  const [activeTab, setActiveTab] = useState("list");
  const [employees, setEmployees] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [deptFilter, setDeptFilter] = useState("All");
  const [modalEmp, setModalEmp] = useState(null); // null = closed, {} = new, emp = edit
  const [modalOpen, setModalOpen] = useState(false);
  const [detailEmp, setDetailEmp] = useState(null);
  const [confirm, confirmModal] = useConfirm();

  const loadEmployees = async () => {
    try {
      const { data } = await api.get("/employees");
      setEmployees(Array.isArray(data) ? data : data.items ?? []);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const { data } = await api.get("/employees/summary");
      setSummary(data);
    } catch {
      // summary is non-critical
    }
  };

  useEffect(() => {
    loadEmployees();
    loadSummary();
    // Silently clean up orphaned user accounts (users with no linked employee)
    api.delete("/users/orphans").catch(() => {});
  }, []);

  // Derived departments list
  const departments = useMemo(() => {
    const depts = new Set(employees.map((e) => e.department).filter(Boolean));
    return ["All", ...Array.from(depts).sort()];
  }, [employees]);

  // Filtered employees
  const filtered = useMemo(() => {
    return employees.filter((e) => {
      const matchQ =
        !q ||
        e.name?.toLowerCase().includes(q.toLowerCase()) ||
        e.mobile?.includes(q) ||
        e.email?.toLowerCase().includes(q.toLowerCase()) ||
        e.job_title?.toLowerCase().includes(q.toLowerCase());
      const matchDept = deptFilter === "All" || e.department === deptFilter;
      return matchQ && matchDept;
    });
  }, [employees, q, deptFilter]);

  const openAdd = () => {
    setModalEmp({});
    setModalOpen(true);
  };

  const openEdit = (emp) => {
    setModalEmp(emp);
    setModalOpen(true);
    setDetailEmp(null);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalEmp(null);
  };

  const handleSaved = () => {
    closeModal();
    loadEmployees();
    loadSummary();
  };

  const handleDelete = async (emp) => {
    if (!(await confirm(`Delete "${emp.name}"? This cannot be undone.`))) return;
    try {
      await api.delete(`/employees/${emp.id}`);
      toast.success("Employee deleted");
      setDetailEmp(null);
      // Optimistic remove so the card disappears even if list refresh is slow
      setEmployees((list) => list.filter((e) => e.id !== emp.id));
      loadEmployees();
      loadSummary();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  // Computed stats (use summary API if available, else derive from local data)
  const totalCount = summary?.total ?? employees.length;
  const activeCount = summary?.active ?? employees.filter((e) => e.status === "active").length;
  const inactiveCount = summary?.inactive ?? employees.filter((e) => e.status !== "active").length;
  const deptCount = summary?.departments ?? new Set(employees.map((e) => e.department).filter(Boolean)).size;

  return (
    <div className="w-full max-w-[1400px] [&_.btn-primary]:!rounded-[9px] [&_.btn-primary]:!border-[#244B39] [&_.btn-primary]:!bg-[#244B39] [&_.btn-primary:hover]:!bg-[#173D2C] [&_.btn-primary:focus-visible]:!ring-2 [&_.btn-primary:focus-visible]:!ring-[#315E48]/30 [&_.btn-primary:focus-visible]:!ring-offset-2 [&_.btn-secondary]:!rounded-[9px] [&_.btn-secondary]:!border-[#CDD6CA] [&_.btn-secondary:hover]:!border-[#9FAF9E] [&_.btn-secondary:hover]:!bg-[#F7F9F4] [&_.btn-secondary:focus-visible]:!ring-2 [&_.btn-secondary:focus-visible]:!ring-[#78917C]/35 [&_.input]:!rounded-[9px] [&_.input]:!border-[#C8D2C5] [&_.input:focus]:!border-[#5F7D67] [&_.input:focus]:!ring-2 [&_.input:focus]:!ring-[#DCE7D8] [&_.table-shell]:!border-[#DCE3D6] [&_.table-head-row]:!border-[#D9E0D6] [&_.table-head-row]:!bg-[#F3F5EE] [&_.table-th]:!text-[#66766A] [&_.table-td]:!border-[#E6E9E2] [&_.table-row:hover_.table-td]:!bg-[#F5F7F1]">
      {/* Page Title Row */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[21px] font-semibold tracking-[-0.02em] text-[#294236]">Employees</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="rounded-full border border-[#DCE3D6] bg-[#F5F7F1] px-2.5 py-1 text-[10.5px] font-semibold text-[#66746A]">
              Total: {totalCount}
            </span>
            <span className="rounded-full border border-[#C8D8C6] bg-[#EAF1E8] px-2.5 py-1 text-[10.5px] font-semibold text-[#315E48]">
              Active: {activeCount}
            </span>
          </div>
        </div>
        {activeTab === "list" && (
          <button
            onClick={openAdd}
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#244B39] bg-[#244B39] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#173D2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315E48]/30 focus-visible:ring-offset-2"
          >
            <Plus size={14} strokeWidth={1.5} />
            Add Employee
          </button>
        )}
      </div>

      {canViewPermissions && (
        <div className="mb-6 flex w-fit items-center gap-1 rounded-[10px] border border-[#DCE3D6] bg-[#F1F3ED] p-1">
          {[
            { id: "list", label: "Employees", icon: Users },
            { id: "permissions", label: "Permissions", icon: ShieldCheck },
          ].map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 rounded-[8px] px-3.5 py-2 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35 ${
                  isActive
                    ? "bg-[#244B39] text-white shadow-[0_1px_2px_rgba(26,58,41,0.16)]"
                    : "text-[#65736A] hover:bg-white hover:text-[#315E48]"
                }`}
              >
                <Icon size={14} strokeWidth={1.5} />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {activeTab === "permissions" && canViewPermissions ? (
        <PermissionsTab canWrite={canWritePermissions} />
      ) : (
      <>
      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Users} label="Total" value={totalCount} />
        <StatCard icon={UserCheck} label="Active" value={activeCount} color="text-emerald-700" />
        <StatCard icon={UserX} label="Inactive" value={inactiveCount} color="text-red-600" />
        <StatCard icon={LayoutGrid} label="Departments" value={deptCount} />
      </div>

      {/* Search + Filter Row */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7C897F]" strokeWidth={1.7} />
          <input
            className="w-full rounded-[9px] border border-[#C8D2C5] bg-white py-2 pl-9 pr-3 text-[12.5px] text-[#294236] placeholder-[#9AA39B] transition-colors focus:border-[#5F7D67] focus:outline-none focus:ring-2 focus:ring-[#DCE7D8]"
            placeholder="Search name, mobile, email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {/* Department Filter Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {departments.map((d) => (
            <button
              key={d}
              onClick={() => setDeptFilter(d)}
              className={`h-8 rounded-[8px] border px-3 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35 ${
                deptFilter === d
                  ? "border-[#244B39] bg-[#244B39] text-white"
                  : "border-[#DCE3D6] bg-[#F5F7F1] text-[#5F6F63] hover:border-[#B4C2B2] hover:bg-white hover:text-[#315E48]"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Employee Grid */}
      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <CardGridSkeleton count={8} cols={4} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-[#C7D2C4] bg-[#F8F9F5] px-6 py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[10px] border border-[#D6DED3] bg-[#EEF2EA] text-[#6D7D71]">
            <Users size={22} strokeWidth={1.5} />
          </div>
          <p className="text-[15px] font-medium text-[#294236]">
            {q || deptFilter !== "All" ? "No employees match your filter" : "No employees yet"}
          </p>
          <p className="text-[13px] text-[#737373] mt-1">
            {q || deptFilter !== "All"
              ? "Try adjusting your search or department filter."
              : "Add your first employee to get started."}
          </p>
          {!q && deptFilter === "All" && (
            <button
              onClick={openAdd}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#244B39] bg-[#244B39] px-4 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#173D2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315E48]/30 focus-visible:ring-offset-2"
            >
              <Plus size={14} strokeWidth={1.5} />
              Add Employee
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((emp) => (
            <EmployeeCard
              key={emp.id}
              emp={emp}
              onClick={() => setDetailEmp(emp)}
            />
          ))}
        </div>
      )}

      {/* Detail Side Panel */}
      {detailEmp && (
        <DetailPanel
          emp={detailEmp}
          onClose={() => setDetailEmp(null)}
          onEdit={() => openEdit(detailEmp)}
          onDelete={() => handleDelete(detailEmp)}
        />
      )}

      {/* Add / Edit Modal */}
      {modalOpen && (
        <EmployeeModal
          emp={modalEmp?.id ? modalEmp : null}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}

      {confirmModal}
      </>
      )}
    </div>
  );
}
