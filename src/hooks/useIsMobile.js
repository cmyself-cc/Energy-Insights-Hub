import { useState, useEffect } from "react";

const QUERY = "(max-width: 768px)";

export function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(isMobileViewport);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
