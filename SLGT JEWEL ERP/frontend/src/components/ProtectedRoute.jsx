import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useApplicationFeatures } from "@/context/ApplicationFeatureContext";
import { APPLICATION_FEATURES } from "@/config/applicationFeatures";
import { APP_WINDOW_TITLE } from "@/lib/appBrand";
import slgtLogo from "@/assets/slgt-logo.png";

export function BrandedLoading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-white">
      <div className="rounded-xl bg-black border border-[#E5E7EB] overflow-hidden shadow-sm animate-pulse">
        <img
          src={slgtLogo}
          alt={APP_WINDOW_TITLE}
          className="h-28 w-auto max-w-[260px] object-contain"
        />
      </div>
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="h-2 w-2 rounded-full bg-[#B49042]"
            style={{ animation: `bounce 1s ease-in-out ${i * 0.15}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Shown when a route's application feature is licensed OFF for this shop —
 * distinct from a permission failure: the module simply isn't installed for
 * this shop, so it gets a plain explanation instead of a silent redirect. */
function FeatureNotEnabled({ featureKey }) {
  const label = APPLICATION_FEATURES.find((f) => f.key === featureKey)?.label || "This module";
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-white px-6 text-center">
      <h1 className="font-display text-[20px] font-semibold text-[#0A0A0A]">
        {label} is not enabled for this shop
      </h1>
      <p className="text-[13.5px] text-[#737373] max-w-sm">
        This module isn't part of your shop's current plan. Contact your administrator if you believe this is a mistake.
      </p>
      <Link
        to="/"
        className="mt-2 inline-flex items-center rounded-md bg-[#0A0A0A] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#262626]"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}

// module: optional — if provided, user must have can(module, action) or they are redirected to "/"
// feature: optional — if provided, the shop must have this application feature
// enabled (Application Management), independent of the user's permissions.
export default function ProtectedRoute({ children, module, action = "view", feature }) {
  const { user, loading, can } = useAuth();
  const { isEnabled, loading: featuresLoading } = useApplicationFeatures();
  if (loading) return <BrandedLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (feature && !featuresLoading && !isEnabled(feature)) return <FeatureNotEnabled featureKey={feature} />;
  if (module && !can(module, action)) return <Navigate to="/" replace />;
  return children;
}
