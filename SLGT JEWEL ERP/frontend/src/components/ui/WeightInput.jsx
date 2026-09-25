import { forwardRef } from "react";
import { parseWeightInput, sanitizeWeightDraft } from "@/lib/weightInput";

/**
 * Gram-weight field. Typing is limited to 3 decimal places (0.001 g).
 * `onValueChange(raw, number)` mirrors MoneyInput.
 */
const WeightInput = forwardRef(function WeightInput(
  {
    value,
    onValueChange,
    onChange,
    onBlur,
    className = "input",
    allowNegative = false,
    ...props
  },
  ref,
) {
  const handleChange = (event) => {
    const raw = sanitizeWeightDraft(event.target.value, { allowNegative });
    onValueChange?.(raw, parseWeightInput(raw, 0));
    if (onChange) {
      const next = { ...event, target: { ...event.target, value: raw } };
      onChange(next);
    }
  };

  return (
    <input
      ref={ref}
      {...props}
      type="text"
      inputMode="decimal"
      placeholder={props.placeholder ?? "0.000"}
      className={className}
      value={value ?? ""}
      onChange={handleChange}
      onBlur={onBlur}
      onWheel={(event) => event.currentTarget.blur()}
    />
  );
});

export default WeightInput;
