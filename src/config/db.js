// config/db.js
import { neon } from "@neondatabase/serverless";
import "dotenv/config";

export const sql = neon(process.env.DATABASE_URL);

export async function initDB() {
  try {
    // users table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        clerk_id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        avatar_url TEXT,
        email TEXT,
        phone TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    // friendship_status enum
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'friendship_status') THEN
          CREATE TYPE friendship_status AS ENUM ('pending','accepted','rejected','blocked');
        END IF;
      END$$
    `;

    // friendships table
    await sql`
      CREATE TABLE IF NOT EXISTS friendships (
        id BIGSERIAL PRIMARY KEY,
        requester_clerk_id TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE CASCADE,
        receiver_clerk_id TEXT NOT NULL REFERENCES users(clerk_id) ON DELETE CASCADE,
        status friendship_status NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (requester_clerk_id, receiver_clerk_id)
      )
    `;

    // optional indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_friendships_receiver ON friendships (receiver_clerk_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requester_clerk_id)`;

    console.log("Database initialized successfully");
  } catch (error) {
    console.log("Error initializing DB", error);
    process.exit(1);
  }
}
