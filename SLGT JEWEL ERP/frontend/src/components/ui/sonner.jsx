import { Toaster as Sonner, toast } from "sonner";

const Toaster = (props) => (
  <Sonner
    className="toaster group"
    toastOptions={{
      style: {
        background: "#0A0A0A",
        color: "white",
        border: "1px solid #262626",
        fontFamily: "Manrope, sans-serif",
        fontSize: "13px",
      },
    }}
    {...props}
  />
);

export { Toaster, toast };
