import "dotenv/config";
import bcrypt from "bcryptjs";
import { db, migrate } from "../db.js";

migrate();

const SALT_ROUNDS = 12;

// Only seeds the admin account - 'user'-role logins authenticate against
// each hub's own real JK_BMS_HUB/{hub_id}/userCong node in Firebase (see
// routes/auth.js), which already exists in the live database, so there's
// nothing to seed for them here.
//
// Upsert, not insert - re-running this script never duplicates the row or
// wipes it; any other user already in the table is left alone.
function upsertAdmin(email, plainPassword) {
  const passwordHash = bcrypt.hashSync(plainPassword, SALT_ROUNDS);
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?").run(passwordHash, existing.id);
    return existing.id;
  }
  const info = db
    .prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')")
    .run(email, passwordHash);
  return info.lastInsertRowid;
}

const adminEmail = process.env.DEFAULT_ADMIN_EMAIL;
const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.error("Missing DEFAULT_ADMIN_EMAIL/DEFAULT_ADMIN_PASSWORD - check server/.env against .env.example");
  process.exit(1);
}

const adminId = upsertAdmin(adminEmail, adminPassword);
console.log(`Seeded admin (id=${adminId}): ${adminEmail}`);
