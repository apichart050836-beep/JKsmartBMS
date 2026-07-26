// A 'user'-role session always has exactly one hub - the one whose
// JK_BMS_HUB/{hubId}/userCong credential it logged in with (see
// routes/auth.js). That hubId is embedded straight in the signed JWT at
// login time, not looked up per-request, so there's no separate mapping
// table that could drift out of sync with what's actually in Firebase.
// 'admin' sessions carry no hubId - they bypass this entirely.

// null return means "no restriction" (admin - sees every hub).
export function allowedHubIds(user) {
  if (user.role === "admin") return null;
  return user.hubId ? [user.hubId] : [];
}

// Ownership check for any per-hub write route - never infer this from
// anything the client sent in the request body, only from the verified
// session token.
export function canAccessHub(user, hubId) {
  if (user.role === "admin") return true;
  return user.hubId === hubId;
}
