import { clerkClient } from "@clerk/clerk-sdk-node";
import { sql } from "../config/db.js";

// For development, mock logged-in user

// ------------------- SEARCH USERS -------------------
export async function searchUsers(req, res) {
  try {
    const q = req.query.q;
    const currentUserId = req.headers["x-clerk-id"];

    if (!q) return res.status(400).json({ message: "Query required" });
    if (!currentUserId)
      return res.status(401).json({ message: "Unauthorized" });

    // 1. Search users in Clerk
    const users = await clerkClient.users.getUserList({
      query: q,
      limit: 20,
    });

    // 2. Map users + compute friendship status
    const mapped = await Promise.all(
      users.map(async (u) => {
        if (u.id === currentUserId) return null;

        const friendship = await sql`
          SELECT status
          FROM friendships
          WHERE
            (requester_clerk_id = ${currentUserId} AND receiver_clerk_id = ${u.id})
            OR
            (requester_clerk_id = ${u.id} AND receiver_clerk_id = ${currentUserId})
          LIMIT 1
        `;

        let status = "none";

        if (friendship.length > 0) {
          if (friendship[0].status === "accepted") {
            status = "friend";
          } else if (friendship[0].status === "pending") {
            status = "pending";
          }
        }

        return {
          clerk_id: u.id,
          username: u.username,
          display_name:
            [u.first_name, u.last_name].filter(Boolean).join(" ") ||
            u.username,
          avatar_url: u.profile_image_url || null,
          status,
        };
      })
    );

    const filtered = mapped.filter(Boolean);

    console.log("Users found with status:", filtered);
    res.status(200).json(filtered);
  } catch (error) {
    console.error("searchUsers error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// ------------------- SEND FRIEND REQUEST -------------------
export async function sendRequest(req, res) {
  try {
    const { receiver_clerk_id } = req.body;
    const requester_clerk_id = req.headers["x-clerk-id"] || "user_35lwabxQXGdwAEQeo4g1xUL3Wjc";

    if (!receiver_clerk_id) {
      return res.status(400).json({ message: "Missing receiver_clerk_id" });
    }

    console.log("Requester ID:", requester_clerk_id, "Receiver ID:", receiver_clerk_id);

    // ---------------- Ensure users exist ----------------
    const clerkIds = [requester_clerk_id, receiver_clerk_id];
    const users = await clerkClient.users.getUserList({ userId: clerkIds });

    for (const u of users) {
      await sql`
        INSERT INTO users(clerk_id, username, display_name, avatar_url)
        VALUES (${u.id}, ${u.username || u.id}, ${u.first_name || ""} || ' ' || ${u.last_name || ""}, ${u.profile_image_url})
        ON CONFLICT (clerk_id) DO NOTHING
      `;
    }

    // ---------------- Check for duplicate request ----------------
    const existing = await sql`
      SELECT * FROM friendships 
      WHERE requester_clerk_id = ${requester_clerk_id} 
        AND receiver_clerk_id = ${receiver_clerk_id}
    `;
    if (existing.length > 0) {
      return res.status(400).json({ message: "Request already exists" });
    }

    // ---------------- Insert new request ----------------
    const inserted = await sql`
      INSERT INTO friendships(requester_clerk_id, receiver_clerk_id)
      VALUES (${requester_clerk_id}, ${receiver_clerk_id})
      RETURNING *
    `;

    console.log("Inserted friendship:", inserted[0]);
    res.status(201).json(inserted[0]);
  } catch (error) {
    console.error("sendRequest error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}



// ------------------- ACCEPT FRIEND REQUEST -------------------
export async function acceptRequest(req, res) {
  try {
    const { requester_clerk_id } = req.body;
    const receiver_clerk_id = req.headers["x-clerk-id"];

    const updated = await sql`
      UPDATE friendships
      SET status = 'accepted', updated_at = now()
      WHERE requester_clerk_id = ${requester_clerk_id} 
        AND receiver_clerk_id = ${receiver_clerk_id}
      RETURNING *
    `;

    if (updated.length === 0)
      return res.status(404).json({ message: "Request not found" });

    res.status(200).json(updated[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// ------------------- REJECT / CANCEL REQUEST -------------------
export async function cancelRequest(req, res) {
  try {
    const { requester_clerk_id, receiver_clerk_id } = req.body;

    const deleted = await sql`
      DELETE FROM friendships
      WHERE (requester_clerk_id = ${requester_clerk_id} AND receiver_clerk_id = ${receiver_clerk_id})
         OR (requester_clerk_id = ${receiver_clerk_id} AND receiver_clerk_id = ${requester_clerk_id})
      RETURNING *
    `;

    res.status(200).json({ deleted: deleted.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// ------------------- GET INCOMING REQUESTS -------------------
export async function getIncoming(req, res) {
  try {
    const receiver_clerk_id = req.headers["x-clerk-id"];

    const requests = await sql`
      SELECT f.id, u.clerk_id, u.username, u.display_name, u.avatar_url
      FROM friendships f
      JOIN users u ON f.requester_clerk_id = u.clerk_id
      WHERE f.receiver_clerk_id = ${receiver_clerk_id} AND f.status = 'pending'
    `;

    res.status(200).json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// ------------------- GET OUTGOING REQUESTS -------------------
export async function getOutgoing(req, res) {
  try {
    const requester_clerk_id = req.headers["x-clerk-id"];

    const requests = await sql`
      SELECT f.id, u.clerk_id, u.username, u.display_name, u.avatar_url
      FROM friendships f
      JOIN users u ON f.receiver_clerk_id = u.clerk_id
      WHERE f.requester_clerk_id = ${requester_clerk_id} AND f.status = 'pending'
    `;

    res.status(200).json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// ------------------- GET FRIENDS -------------------
export async function getFriends(req, res) {
  try {
    const clerk_id = req.headers["x-clerk-id"];

    const myfriends = await sql`
      SELECT u.clerk_id, u.username, u.display_name, u.avatar_url
      FROM friendships f
      JOIN users u
        ON (f.requester_clerk_id = u.clerk_id AND f.receiver_clerk_id = ${clerk_id})
        OR (f.receiver_clerk_id = u.clerk_id AND f.requester_clerk_id = ${clerk_id})
      WHERE f.status = 'accepted'
    `;

    res.status(200).json(myfriends);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
}
