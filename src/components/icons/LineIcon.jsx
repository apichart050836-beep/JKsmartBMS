import React from "react";

// A simple LINE-style chat-bubble glyph, drawn with currentColor like every
// lucide-react icon used elsewhere in this app - drops into the same
// colored-badge wrapper pattern (a parent span setting bg-*/text-*) instead
// of carrying its own fixed background, so it can sit on the TopBar's
// neutral button, the modal's green CTA, or the "linked" status badge and
// pick up whichever color that context already uses.
export function LineIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 3.5C6.98 3.5 3 6.98 3 11.25c0 3.83 3.15 7.02 7.4 7.63.29.06.68.2.78.46.09.24.06.61.03.85l-.13.79c-.04.24-.19.94.82.51s5.44-3.2 7.42-5.48C20.42 14 21 12.68 21 11.25 21 6.98 17.02 3.5 12 3.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
