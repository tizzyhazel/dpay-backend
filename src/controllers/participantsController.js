import { sql } from "../config/db.js";

export async function assignParticipants(req, res) {
  try {
    const { billId } = req.params;
    const { participants } = req.body; // array of clerk IDs

    if (!participants || !Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ message: "No participants provided" });
    }

    // Insert each participant
    const inserted = await Promise.all(
      participants.map((clerkId) =>
        sql`
          INSERT INTO bill_participants (bill_id, user_clerk_id)
          VALUES (${billId}, ${clerkId})
          ON CONFLICT (bill_id, user_clerk_id) DO NOTHING
          RETURNING *
        `
      )
    );

    res.status(201).json({
      message: "Participants assigned successfully",
      participants: inserted.flat(),
    });
  } catch (error) {
    console.error("assignParticipants error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}