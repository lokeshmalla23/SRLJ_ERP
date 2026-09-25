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
        <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#F8F4EA] px-4 py-8 text-center sm:px-6">
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[min(480px,110vw)] w-[min(480px,110vw)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#DCCBAA]/60"
            style={{ background: "radial-gradient(circle, rgba(180, 144, 66, 0.09), rgba(248, 244, 234, 0) 70%)" }}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-2xl rounded-[22px] border border-[#DCCBAA] bg-[#FCFAF4]/95 px-5 py-7 shadow-[0_22px_65px_rgba(23,63,50,0.13)] sm:px-8 sm:py-8">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[14px] border border-[#B49042]/60 bg-[#173F32] shadow-[0_10px_24px_rgba(23,63,50,0.18)]">
              <AlertTriangle size={22} className="text-[#DCCBAA]" strokeWidth={1.75} />
            </div>
            <h1 className="mt-4 font-display text-[18px] font-semibold text-[#173F32]">{title}</h1>
            <p className="mx-auto mt-1.5 max-w-lg text-[13px] leading-relaxed text-[#66736B]">
              This screen crashed. The error is shown below — you can retry or go back home.
            </p>

            <div className="mt-6 w-full rounded-[14px] border border-[#E7C8BC] bg-[#FBF0EC] px-4 py-3.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8A3F32]">
                Error
              </div>
              <div className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-[#5C3430]">
                {message}
              </div>
              {stack && (
                <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#8A5147]/90">
                  {String(stack).slice(0, 2500)}
                </pre>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#173F32] bg-[#173F32] px-4 py-2 text-[13px] font-semibold text-[#FCFAF4] shadow-sm transition-colors hover:bg-[#24513F] focus:outline-none focus:ring-2 focus:ring-[#B49042]/50"
                onClick={this.handleRetry}
              >
                <RefreshCw size={14} strokeWidth={1.75} />
                Try again
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8C8A6] bg-[#F6F0E4] px-4 py-2 text-[13px] font-semibold text-[#173F32] transition-colors hover:border-[#C9B587] hover:bg-[#F0E8D8] focus:outline-none focus:ring-2 focus:ring-[#B49042]/40"
                onClick={this.handleHome}
              >
                <Home size={14} strokeWidth={1.75} />
                Go to Dashboard
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8C8A6] bg-[#FCFAF4] px-4 py-2 text-[13px] font-medium text-[#5E6B63] transition-colors hover:border-[#C9B587] hover:bg-[#F6F0E4] focus:outline-none focus:ring-2 focus:ring-[#B49042]/40"
                onClick={this.handleCopy}
              >
                {this.state.copied ? <Check size={14} /> : <Copy size={14} strokeWidth={1.75} />}
                {this.state.copied ? "Copied" : "Copy error"}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
