import { useEffect, useState } from "react";
import type { VenueStatus } from "../types";

export function useCountdown(status: VenueStatus | null): number {
  const anchor = status ? Number(status.endsAt - status.chainNow) : 0;
  const [remaining, setRemaining] = useState(anchor);

  useEffect(() => {
    setRemaining(anchor);
    if (anchor <= 0) return;
    const id = setInterval(() => setRemaining((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [anchor]);

  return status ? remaining : 0;
}
