// Vite auto-increments its port (5174, 5175, ...) whenever an earlier dev
// server is still holding 5173 - a hardcoded single CLIENT_ORIGIN silently
// blocks every request from that origin the moment this happens, including
// the Socket.IO handshake (which has its own separate CORS check from the
// plain HTTP one). This is a local single-user dev tool, never exposed
// publicly, so allowing any localhost/127.0.0.1 origin removes that whole
// class of failure instead of chasing whatever port Vite happened to land
// on. Shared by index.js (HTTP) and realtime.js (Socket.IO) so both always
// agree - this bug already recurred once from the two being defined separately.
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// RENDER_EXTERNAL_URL is auto-populated by Render for every web service (the
// live https://<name>.onrender.com URL) - using it means the deployed
// frontend's own same-origin requests (module scripts/stylesheets with a
// crossorigin attribute, and the Socket.IO handshake, both of which send an
// Origin header even though they're same-origin) are allowed without the
// user needing to manually set anything in the Render dashboard.
export function isAllowedOrigin(origin) {
  return (
    !origin ||
    LOCALHOST_ORIGIN.test(origin) ||
    origin === process.env.CLIENT_ORIGIN ||
    origin === process.env.RENDER_EXTERNAL_URL
  );
}
