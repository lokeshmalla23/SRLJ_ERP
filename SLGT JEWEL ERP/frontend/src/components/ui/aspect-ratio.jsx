import { forwardRef } from "react";

const AspectRatio = forwardRef(({ ratio = 1, children, style, ...props }, ref) => (
  <div
    ref={ref}
    style={{ position: "relative", paddingBottom: `${(1 / ratio) * 100}%`, ...style }}
    {...props}
  >
    <div style={{ position: "absolute", inset: 0 }}>{children}</div>
  </div>
));
AspectRatio.displayName = "AspectRatio";

export { AspectRatio };
export default AspectRatio;
