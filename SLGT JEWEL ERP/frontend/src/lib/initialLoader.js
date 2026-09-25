// Hides the static index.html preloader (see index.html) once React has
// mounted and the app's initial data is ready. Waits for web fonts too, so
// the preloader never hands off to a page still visibly reflowing text.
export function hideInitialLoader() {
  const run = () => {
    if (typeof window !== "undefined" && typeof window.__hideAppPreloader === "function") {
      window.__hideAppPreloader();
    }
  };
  if (typeof document !== "undefined" && document.fonts?.ready) {
    document.fonts.ready.then(run, run);
  } else {
    run();
  }
}
