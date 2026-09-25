import { useLocation } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";

/** Clears the error UI automatically when the user navigates to another route. */
export default function RouteErrorBoundary({ children, title }) {
  const location = useLocation();
  const resetKey = `${location.pathname}${location.search}${location.hash}`;
  return (
    <ErrorBoundary resetKey={resetKey} title={title}>
      {children}
    </ErrorBoundary>
  );
}
