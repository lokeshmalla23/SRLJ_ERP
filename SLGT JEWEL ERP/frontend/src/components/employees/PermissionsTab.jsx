import { useEffect, useState } from "react";
import { Save, KeyRound, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { permissionsToActionArrays, actionArraysToPermissionsObject } from "@/lib/permissions";
import { SettingsSection, SettingsTabFrame } from "@/components/settings/settingsLayout";

/** Moved here from Settings.jsx — "what can this employee do" belongs with the
 * rest of employee management, not buried in Settings. Behavior unchanged. */
function normalizePerms(raw) {
  return permissionsToActionArrays(raw);
}

/** Reset an employee's login password without knowing their old one — the
 * standard "they forgot it and called for help" flow. ERP Administrator only
 * (not even the shop owner) — the backend enforces this independently of
 * whatever `users.edit` permission is on this login, since this bypasses the
 * old password entirely. After a successful reset the new password stays on
 * screen (not just a toast) so the administrator can read it back over the
 * phone — that's the actual "recovery" this can offer; the old value is
 * never retrievable. */
function ResetPasswordButton({ userId, userName, isSuperAdmin }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justSet, setJustSet] = useState(null); // the password just saved, kept visible

  const reset = async () => {
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/users/${userId}`, { password });
      toast.success(`Password reset for ${userName}`);
      setJustSet(password);
      setOpen(false);
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!isSuperAdmin) return null;

  if (justSet) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-900">
        <KeyRound size={13} strokeWidth={1.5} />
        New password for {userName}: <span className="font-mono font-semibold">{justSet}</span>
        <button type="button" className="ml-1 underline" onClick={() => setJustSet(null)}>Done</button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        <KeyRound size={13} strokeWidth={1.5} /> Reset Password
      </button>
    );
  }

  return (
    <div className="border border-[#E5E7EB] rounded-lg p-3 bg-[#F9FAFB] flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="block text-[10.5px] uppercase tracking-[0.08em] font-semibold text-[#737373] mb-1">New password</span>
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            className="input w-44"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 6 characters"
          />
          <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#a3a3a3]" onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </label>
      <label className="block">
        <span className="block text-[10.5px] uppercase tracking-[0.08em] font-semibold text-[#737373] mb-1">Confirm</span>
        <input
          type={show ? "text" : "password"}
          className="input w-44"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </label>
      <button type="button" className="btn-primary" disabled={busy} onClick={reset}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setOpen(false); setPassword(""); setConfirmPassword(""); }}>
        Cancel
      </button>
    </div>
  );
}

/** Owner/employee login passwords are one-way hashed — nobody, including the
 * ERP Administrator, can ever see the original value, only reset it (button
 * above). Usernames, unlike passwords, are plain text (they're just the
 * login email) so they can be listed here safely. The Hidden Bill PIN is the
 * one secret actually stored in plain text, so it alone can be revealed. All
 * of this is restricted to the reserved super_admin login for support calls. */
function RecoveryTools({ users }) {
  const [state, setState] = useState(null); // { configured, password, updated_at } | {}
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);

  const reveal = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/settings/hidden-bill/reveal");
      setState(data);
      setRevealed(true);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsSection
      title="Recovery Tools"
      description="Visible only to the ERP Administrator login — for support calls when a shop has locked itself out of a secret."
      tone="emphasis"
    >
      <div className="flex items-start gap-2 mb-4 text-[12px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2">
        <ShieldAlert size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
        Login passwords are one-way encrypted and can never be shown — only reset ("Reset Password" above). Usernames aren't encrypted, so they can be looked up below; the Hidden Bill PIN is the only password-type secret stored in plain form, recoverable the same way.
      </div>

      <div className="mb-5">
        <div className="text-[12.5px] font-semibold text-[#0A0A0A] mb-2">Shop logins (usernames only)</div>
        <div className="table-shell">
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Name</th>
                <th className="table-th">Username (login email)</th>
                <th className="table-th">Role</th>
              </tr>
            </thead>
            <tbody>
              {(users || []).length === 0 ? (
                <tr><td className="table-td text-[#737373]" colSpan={3}>No logins found.</td></tr>
              ) : users.map((u) => (
                <tr key={u.id} className="table-row">
                  <td className="table-td font-medium">{u.name}</td>
                  <td className="table-td font-mono text-[12.5px]">{u.email}</td>
                  <td className="table-td capitalize">{String(u.role || "").replace(/_/g, " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-[13px] text-[#0A0A0A]">
          <span className="font-medium">Hidden Bill password:</span>{" "}
          {!revealed ? (
            <span className="text-[#a3a3a3]">hidden</span>
          ) : state?.configured ? (
            <span className="font-mono">{state.password}</span>
          ) : (
            <span className="text-[#a3a3a3]">not configured for this shop</span>
          )}
        </div>
        {!revealed && (
          <button type="button" className="btn-secondary" disabled={loading} onClick={reveal}>
            {loading ? "Loading…" : "Reveal"}
          </button>
        )}
      </div>
    </SettingsSection>
  );
}

export default function PermissionsTab({ canWrite = false }) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const { ownerName } = useCompany();
  const [meta, setMeta] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [perms, setPerms] = useState({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = () => {
    setLoadError("");
    Promise.all([
      api.get("/meta/roles"),
      api.get("/users"),
    ])
      .then(([metaRes, userRes]) => {
        setMeta(metaRes.data);
        const list = Array.isArray(userRes.data) ? userRes.data : [];
        setUsers(list);
        setSelectedUserId((prev) => {
          if (prev && list.some((u) => u.id === prev)) return prev;
          const first = list.find((u) => u.role !== "shop_owner") || list[0];
          return first?.id || "";
        });
      })
      .catch((err) => {
        setLoadError(formatApiError(err) || "Failed to load permissions");
        setMeta((m) => m || { roles: [], modules: [], actions: [] });
        setUsers([]);
      });
  };

  useEffect(() => { load(); }, []);

  const selectedUser = users.find((u) => u.id === selectedUserId) || null;

  useEffect(() => {
    if (selectedUser) setPerms(normalizePerms(selectedUser.permissions));
    else setPerms({});
  }, [selectedUserId, selectedUser?.id, selectedUser?.permissions]);

  if (!meta) {
    return (
      <div className="space-y-4">
        <PageLoadingBadge />
        <div className="h-64 shimmer rounded-md" />
      </div>
    );
  }

  const owner = selectedUser?.role === "shop_owner";

  const toggle = (mod, act) => {
    setPerms((p) => {
      const cur = new Set(p[mod] || []);
      if (cur.has(act)) cur.delete(act);
      else cur.add(act);
      return { ...p, [mod]: Array.from(cur) };
    });
  };

  const save = async () => {
    if (!selectedUser) return;
    setBusy(true);
    try {
      const { data } = await api.patch(`/users/${selectedUser.id}`, {
        permissions: (() => {
          const obj = actionArraysToPermissionsObject(perms);
          if (!obj.pos || typeof obj.pos !== "object") obj.pos = {};
          // Always persist POS mode flags so unchecking both is not treated as "legacy"
          obj.pos.jewellery = (perms.pos || []).includes("jewellery");
          obj.pos.pure_metal = (perms.pos || []).includes("pure_metal");
          return obj;
        })(),
      });
      setUsers((list) => list.map((u) => (u.id === data.id ? data : u)));
      setPerms(normalizePerms(data.permissions));
      toast.success("Permissions updated");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsTabFrame>
      {loadError && (
        <div className="mb-1 text-[12.5px] text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {loadError}
          <button type="button" className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}
      <SettingsSection
        title="Permissions"
        description="Choose a login user and toggle module actions. Shop owners always have full access."
      >
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <span className="text-[12.5px] text-[#525252] font-medium">Login user</span>
        <select
          className="input max-w-[360px]"
          value={selectedUserId || ""}
          onChange={(e) => setSelectedUserId(e.target.value)}
        >
          <option value="">— Select person —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.email} ({String(u.role || "").replace(/_/g, " ")})
            </option>
          ))}
        </select>

        {owner && (
          <span className="chip chip-gold">{ownerName} — full access always</span>
        )}
        {selectedUser && !owner && (
          <ResetPasswordButton userId={selectedUser.id} userName={selectedUser.name} isSuperAdmin={isSuperAdmin} />
        )}
      </div>

      {selectedUser ? (
        <>
          <div className="table-shell">
            <table className="w-full">
              <thead>
                <tr className="table-head-row">
                  <th className="table-th">Module</th>
                  {(meta.actions || []).map((a) => (
                    <th key={a} className="table-th text-center capitalize">{a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(meta.modules || []).map((m) => (
                  <tr key={m} className="table-row">
                    <td className="table-td capitalize font-medium">{m.replace(/_/g, " ")}</td>
                    {(meta.actions || []).map((a) => {
                      const checked = owner || (perms[m] || []).includes(a);
                      return (
                        <td key={a} className="table-td text-center">
                          <input
                            type="checkbox"
                            disabled={owner || !canWrite}
                            checked={checked}
                            onChange={() => toggle(m, a)}
                            className="h-4 w-4 rounded border-[#d4d4d8] text-[#0A0A0A] focus:ring-[#B49042]"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* POS billing modes — show Jewellery / Pure Metal independently */}
          <div className="mt-5 rounded-xl border border-[#E6E2DA] bg-[#FCFAF6] p-4">
            <div className="text-[13px] font-semibold text-[#0A0A0A]">POS billing modes</div>
            <div className="text-[12px] text-[#737373] mt-0.5 mb-3">
              Choose which POS screens this login can open. Enable both, or only one.
            </div>
            <div className="flex flex-wrap gap-4">
              {(meta.pos_mode_actions || ["jewellery", "pure_metal"]).map((act) => {
                const checked = owner || (perms.pos || []).includes(act);
                const label = act === "jewellery" ? "Jewellery POS" : act === "pure_metal" ? "Pure Gold / Silver POS" : act;
                return (
                  <label
                    key={act}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border bg-white cursor-pointer ${
                      checked ? "border-[#C08E2D]" : "border-[#E5E7EB]"
                    } ${owner || !canWrite ? "opacity-70 cursor-default" : ""}`}
                  >
                    <input
                      type="checkbox"
                      disabled={owner || !canWrite}
                      checked={checked}
                      onChange={() => toggle("pos", act)}
                      className="h-4 w-4 rounded border-[#d4d4d8] text-[#0A0A0A] focus:ring-[#B49042]"
                    />
                    <span className="text-[13px] font-medium text-[#0A0A0A]">{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {!owner && (
            <div className="mt-5 flex justify-end">
              <button onClick={save} disabled={busy || !canWrite || owner} className="btn-primary">
                <Save size={14} strokeWidth={1.5} /> {busy ? "Saving…" : "Save permissions"}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="text-[13px] text-[#737373] py-8 text-center">
          {users.length === 0
            ? "No login users found. Create a user under Employees first."
            : "Select a person to manage their access permissions."}
        </div>
      )}
      </SettingsSection>

      {isSuperAdmin && <RecoveryTools users={users} />}
    </SettingsTabFrame>
  );
}
