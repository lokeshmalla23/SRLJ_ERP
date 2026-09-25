import { forwardRef, useEffect, useRef, useState } from "react";
import {
  fmtINRPlain,
  formatMoneyInput,
  parseMoneyInput,
} from "@/lib/format";
import {
  cursorForTokenCount,
  cursorTokenCount,
  rawMoney,
  sanitizeMoneyDraft,
} from "@/lib/moneyInput";

/**
 * Controlled money input with live Indian lakh/crore grouping.
 *
 * `value` and `onValueChange` stay unformatted so calculations and API
 * payloads remain numeric-safe. `onValueChange(raw, number)` receives both.
 */
const MoneyInput = forwardRef(function MoneyInput(
  {
    value,
    onValueChange,
    onBlur,
    onFocus,
    maximumFractionDigits = 2,
    fixedOnBlur = true,
    allowNegative = false,
    className = "input",
    ...props
  },
  forwardedRef,
) {
  const localRef = useRef(null);
  const [display, setDisplay] = useState(() =>
    formatMoneyInput(rawMoney(value), { maximumFractionDigits }),
  );

  const setRefs = (node) => {
    localRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  useEffect(() => {
    const incoming = rawMoney(value);
    const current = rawMoney(display);
    const sameAmount = incoming !== ""
      && current !== ""
      && parseMoneyInput(incoming, Number.NaN) === parseMoneyInput(current, Number.NaN);
    if (incoming === current || sameAmount || (incoming === "" && current === "")) return;
    setDisplay(formatMoneyInput(incoming, { maximumFractionDigits }));
  }, [display, maximumFractionDigits, value]);

  const handleChange = (event) => {
    const input = event.currentTarget;
    const tokenCount = cursorTokenCount(input.value, input.selectionStart ?? input.value.length);
    const raw = sanitizeMoneyDraft(input.value, { allowNegative, maximumFractionDigits });

    const nextDisplay = formatMoneyInput(raw, { maximumFractionDigits });
    setDisplay(nextDisplay);
    onValueChange?.(raw, parseMoneyInput(raw, 0));

    requestAnimationFrame(() => {
      const node = localRef.current;
      if (!node || document.activeElement !== node) return;
      const nextCursor = cursorForTokenCount(nextDisplay, tokenCount);
      node.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <input
      ref={setRefs}
      {...props}
      type="text"
      inputMode="decimal"
      className={className}
      value={display}
      onChange={handleChange}
      onFocus={(event) => {
        onFocus?.(event);
      }}
      onBlur={(event) => {
        const amount = parseMoneyInput(display, 0);
        if (display !== "" && display !== "-") {
          setDisplay(
            fixedOnBlur
              ? fmtINRPlain(amount)
              : formatMoneyInput(rawMoney(display), { maximumFractionDigits }),
          );
        }
        onBlur?.(event);
      }}
      onWheel={(event) => event.currentTarget.blur()}
    />
  );
});

export default MoneyInput;
