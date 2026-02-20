import { clerkClient } from "@clerk/clerk-sdk-node";
import { sql } from "../config/db.js";
import bcrypt from "bcrypt";

// ------------------- GET PROFILE -------------------
// ------------------- GET PROFILE -------------------
export async function getProfile(req, res) {
  try {
    const clerk_id = req.headers["x-clerk-id"];
    if (!clerk_id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Get user from Clerk
    const clerkUser = await clerkClient.users.getUser(clerk_id);
    const email = clerkUser.emailAddresses?.[0]?.emailAddress || "";

    // Ensure user exists in DB
    await sql`
      INSERT INTO users (clerk_id, username, email, avatar_url)
      VALUES (${clerk_id}, ${clerkUser.username || clerk_id}, ${email}, 'avatar1.png')
      ON CONFLICT (clerk_id) DO NOTHING
    `;

    // Fetch profile
    const [user] = await sql`
      SELECT
        username,
        phone,
        bank,
        bank_acc,
        avatar_url,
        qrbank,
        push_notify
      FROM users
      WHERE clerk_id = ${clerk_id}
    `;

    res.json({
      clerk_id,
      username: user.username,
      phone: user.phone,
      email,
      bank: user.bank,
      bank_acc: user.bank_acc,
      avatar_url: user.avatar_url || 'avatar1.png', // return filename string
      qr_bank_url: user.qrbank ? Buffer.from(user.qrbank).toString("base64") : null,
      push_enabled: user.push_notify ?? false,
    });
  } catch (err) {
    console.error("🔥 getProfile error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// ------------------- UPDATE PROFILE -------------------
export async function updateProfile(req, res) {
  try {
    const clerk_id = req.headers["x-clerk-id"];
    if (!clerk_id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const {
      username,
      email,
      phone,
      bank,
      bank_acc,
      avatar_url, // now just a filename string
      qr_bank_url,
      push_enabled,
    } = req.body;

    // Update Clerk user
    if (username || email) {
      await clerkClient.users.updateUser(clerk_id, {
        username: username || undefined,
        email_addresses: email
          ? [{ email_address: email, primary: true }]
          : undefined,
      });
    }

    // Update database safely
    await sql`
      UPDATE users
      SET
        username = COALESCE(${username}, username),
        phone = COALESCE(${phone}, phone),
        bank = COALESCE(${bank}, bank),
        bank_acc = COALESCE(${bank_acc}, bank_acc),
        avatar_url = COALESCE(${avatar_url}, avatar_url),  -- filename string
        qrbank = COALESCE(${qr_bank_url}::BYTEA, qrbank),
        push_notify = COALESCE(${push_enabled}, push_notify)
      WHERE clerk_id = ${clerk_id}
    `;

    res.json({ message: "Profile updated successfully" });
  } catch (err) {
    console.error("🔥 updateProfile error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
// ------------------- GET PIN -------------------
export async function getPIN(req, res) {
  try {
    const clerk_id = req.headers["x-clerk-id"];
    if (!clerk_id) return res.status(401).json({ message: "Unauthorized" });

    const [user] = await sql`
      SELECT pin
      FROM users
      WHERE clerk_id = ${clerk_id}
    `;

    // Do NOT send raw PIN, send masked value for frontend
    const masked = user?.pin ? "******" : null;
    res.json({ pin: masked });
  } catch (err) {
    console.error("🔥 getPIN error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// ------------------- UPDATE PIN -------------------
export async function updatePIN(req, res) {
  try {
    const clerk_id = req.headers["x-clerk-id"];
    if (!clerk_id) return res.status(401).json({ message: "Unauthorized" });

    const { currentPIN, newPIN } = req.body;

    // 1️⃣ Validate newPIN
    if (!newPIN) return res.status(400).json({ message: "New PIN is required" });
    if (!/^\d{6}$/.test(newPIN)) {
      return res.status(400).json({ message: "New PIN must be exactly 6 digits" });
    }

    const [user] = await sql`
      SELECT pin
      FROM users
      WHERE clerk_id = ${clerk_id}
    `;

    // 2️⃣ Only check currentPIN if a PIN exists
    if (user?.pin) {
      if (!currentPIN) return res.status(400).json({ message: "Current PIN is required" });

      const match = await bcrypt.compare(currentPIN, user.pin);
      if (!match) return res.status(401).json({ message: "Current PIN is incorrect" });
    }

    // 3️⃣ Hash newPIN and update
    const hashedPIN = await bcrypt.hash(newPIN, 10);
    await sql`
      UPDATE users
      SET pin = ${hashedPIN}
      WHERE clerk_id = ${clerk_id}
    `;

    res.json({ message: "PIN updated successfully" });
  } catch (err) {
    console.error("🔥 updatePIN error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function createUser(req, res) {
  try {
    const { clerk_id, username, display_name, email } = req.body;

    if (!clerk_id || !username || !email) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const result = await sql`
      INSERT INTO users (clerk_id, username, display_name, email, avatar_url)
      VALUES (${clerk_id}, ${username}, ${display_name || username}, ${email}, 'avatar1.png')
      ON CONFLICT (clerk_id) DO NOTHING
      RETURNING *;
    `;

    res.status(200).json({
      message: "User created successfully",
      user: result[0] || null, // null if user already exists
    });
  } catch (err) {
    console.error("🔥 createUser error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
}

// ------------------- CHECK USER EXISTENCE -------------------
export async function checkUser(req, res) {
  try {
    const { clerkId } = req.params;
    if (!clerkId) return res.status(400).json({ message: "Missing clerkId param" });

    const [user] = await sql`
      SELECT 1
      FROM users
      WHERE clerk_id = ${clerkId}
    `;

    res.json({ exists: !!user });
  } catch (err) {
    console.error("🔥 checkUser error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
