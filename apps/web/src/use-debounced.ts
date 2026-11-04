import { useEffect, useState } from "react";

/** `value` after it has stopped changing for `ms`: the input stays live while the list it filters waits. */
export function useDebounced<V>(value: V, ms = 250): V {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
