import React from "react";

// The real official LINE app icon (public/images/line-icon.png, provided
// directly rather than hand-drawn) - already a self-contained green
// circular badge, so callers should NOT also wrap this in their own
// colored circle background (that reads as a circle-inside-a-circle) -
// just size it directly.
export function LineIcon({ className }) {
  return <img src="/images/line-icon.png" alt="LINE" className={className} />;
}
