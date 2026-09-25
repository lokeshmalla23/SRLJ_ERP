export const ACCOUNTS_SETUP_REQUIRED = "ACCOUNTS_SETUP_REQUIRED";
export const OPENING_SETUP_SECTION = "opening-setup";
export const ACCOUNTS_SETUP_COMPLETE_EVENT = "accounts:opening_setup_complete";
export const ACCOUNTS_OPENING_SAVED_EVENT = "accounts:opening_saved";

let rememberedOpeningSetup = null;

export function rememberOpeningSetup(data) {
  if (!data || typeof data !== "object") return rememberedOpeningSetup;
  const current = rememberedOpeningSetup;
  if (isAccountsSetupComplete(current) && !isAccountsSetupComplete(data)) {
    return current;
  }
  if (isAccountsSetupComplete(current) && current.opening_saved && !data.opening_saved) {
    rememberedOpeningSetup = { ...current, ...data, opening_saved: current.opening_saved };
  } else {
    rememberedOpeningSetup = current ? { ...current, ...data } : data;
  }
  return rememberedOpeningSetup;
}

export function getRememberedOpeningSetup() {
  return rememberedOpeningSetup;
}

export function isAccountsSetupRequiredError(err) {
  return err?.response?.data?.code === ACCOUNTS_SETUP_REQUIRED
    || err?.code === ACCOUNTS_SETUP_REQUIRED;
}

export function goToAccountsSetup(navigate) {
  try {
    localStorage.setItem("accounts.section", OPENING_SETUP_SECTION);
  } catch {
    /* ignore */
  }
  navigate("/accounts");
}

export function isAccountsSetupComplete(data) {
  if (!data) return false;
  if (String(data.accounts_setup_status || "").toUpperCase() === "COMPLETED") return true;
  return Boolean(data.setup_complete);
}

export function isLiveFinancialMode(data) {
  if (String(data?.financial_mode || "").toUpperCase() === "LIVE") return true;
  return isAccountsSetupComplete(data);
}

export function isPreAccountsMode(data) {
  if (!data) return false;
  if (String(data.financial_mode || "").toUpperCase() === "PRE_ACCOUNTS") return true;
  return !isAccountsSetupComplete(data);
}

export function isPreAccountsInvoice(row) {
  if (!row) return false;
  if (String(row.financial_mode || "").toUpperCase() === "PRE_ACCOUNTS") return true;
  return /^TEST[-/]/i.test(String(row.invoice_no || ""));
}

export function isPreAccountsQuotation(row) {
  if (!row) return false;
  if (String(row.financial_mode || "").toUpperCase() === "PRE_ACCOUNTS") return true;
  return /^TEST-/i.test(String(row.quote_no || ""));
}

export function isTestModeFromSetup(data) {
  return isPreAccountsMode(data) || !isAccountsSetupComplete(data);
}

export function isAccountsSetupCompleteEvent(detail) {
  if (!detail) return false;
  const t = detail.type;
  if (t !== ACCOUNTS_SETUP_COMPLETE_EVENT && t !== ACCOUNTS_OPENING_SAVED_EVENT) return false;
  if (detail.setup_complete === true) return true;
  if (String(detail.financial_mode || "").toUpperCase() === "LIVE") return true;
  if (String(detail.accounts_setup_status || "").toUpperCase() === "COMPLETED") return true;
  return isAccountsSetupComplete(detail.status);
}

export function liveSetupFromEvent(detail) {
  return detail?.status || {
    setup_complete: true,
    financial_mode: detail?.financial_mode || "LIVE",
    accounts_setup_status: detail?.accounts_setup_status || "COMPLETED",
  };
}
