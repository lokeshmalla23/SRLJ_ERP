import { Component } from "react";
import { AlertTriangle, Home, RefreshCw, Copy, Check } from "lucide-react";

/**
 * Catches React render errors so a page crash shows a clear message
 * instead of a blank Electron window.
 *
 * Pass `resetKey` (e.g. current route) to clear the error when navigating away.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, info: null, copied: false });
    }
  }

  handleRetry = () => {
    this.setState({ error: null, info: null, copied: false });
    if (typeof this.props.onRetry === "function") this.props.onRetry();
  };

  handleHome = () => {
    this.setState({ error: null, info: null, copied: false });
    window.location.hash = "#/";
  };

  handleCopy = async () => {
    const { error, info } = this.state;
    const text = [
      error?.message || String(error),
      error?.stack,
      info?.componentStack,
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // ignore
    }
  };

  render() {
    if (this.state.error) {
      const message = this.state.error?.message || "Unexpected error";
      const stack = this.state.error?.stack || this.state.info?.componentStack || "";
      const title = this.props.title || "Something went wrong";

      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="h-12 w-12 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
            <AlertTriangle size={22} className="text-red-600" strokeWidth={1.75} />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-[#0A0A0A]">{title}</div>
            <div className="text-[13px] text-[#737373] mt-1 max-w-lg mx-auto">
              This screen crashed. The error is shown below — you can retry or go back home.
            </div>
          </div>

          <div className="w-full max-w-xl text-left rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-red-700 mb-1">
              Error
            </div>
            <div className="text-[13px] text-red-900 font-mono break-words whitespace-pre-wrap">
              {message}
            </div>
            {stack && (
              <pre className="mt-3 max-h-40 overflow-auto text-[11px] text-red-800/80 font-mono whitespace-pre-wrap break-words">
                {String(stack).slice(0, 2500)}
              </pre>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] rounded-lg bg-[#0A0A0A] text-white hover:bg-[#262626]"
              onClick={this.handleRetry}
            >
              <RefreshCw size={14} strokeWidth={1.75} />
              Try again
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] rounded-lg border border-[#E5E7EB] bg-white text-[#0A0A0A] hover:bg-[#F9FAFB]"
              onClick={this.handleHome}
            >
              <Home size={14} strokeWidth={1.75} />
              Go to Dashboard
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] rounded-lg border border-[#E5E7EB] bg-white text-[#525252] hover:bg-[#F9FAFB]"
              onClick={this.handleCopy}
            >
              {this.state.copied ? <Check size={14} /> : <Copy size={14} strokeWidth={1.75} />}
              {this.state.copied ? "Copied" : "Copy error"}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
