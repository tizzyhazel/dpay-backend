import { sql } from "../config/db.js";

/**
 * Get all requests where other users owe the current user
 * Aggregated per friend
 */
export async function getRequestsOwedToUser(req, res) {
  try {
    const payeeClerkId = req.headers["x-clerk-id"];
    if (!payeeClerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Aggregate settlements per friend, grouped by currency
    const settlements = await sql`
      SELECT 
        bs.payer_clerk_id,
        u.username AS payer_username,
        u.avatar_url AS payer_avatar,
        b.currency,
        SUM(bs.amount_owed - bs.amount_paid) AS total_owed
      FROM bill_settlements bs
      JOIN users u ON bs.payer_clerk_id = u.clerk_id
      JOIN bills b ON bs.bill_id = b.id
      WHERE bs.payee_clerk_id = ${payeeClerkId}
        AND bs.status != 'paid'
      GROUP BY bs.payer_clerk_id, u.username, u.avatar_url, b.currency
      ORDER BY u.username, b.currency
    `;

    // Group by payer_clerk_id to create multiple currency amounts per friend
    const grouped = {};
    settlements.forEach(s => {
      const id = s.payer_clerk_id;
      if (!grouped[id]) {
        grouped[id] = {
          payer_clerk_id: id,
          payer_username: s.payer_username,
          payer_avatar: s.payer_avatar,
          amounts: [], // array of { currency, total_owed }
        };
      }

      grouped[id].amounts.push({
        currency: s.currency,
        total_owed: parseFloat(s.total_owed),
      });
    });

    const result = Object.values(grouped);

    res.status(200).json({ settlements: result });
  } catch (err) {
    console.error("getRequestsOwedToUser error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getRequestsGroupedByBill(req, res) {
  try {
    const payeeClerkId = req.headers["x-clerk-id"];
    if (!payeeClerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Fetch all settlements for this user with bill info, including total_bill
    const rows = await sql`
      SELECT 
        bs.bill_id,
        b.bill_name,
        b.bill_date,
        b.currency,
        b.total_bill,       -- ✅ add this
        bs.payer_clerk_id,
        u.username AS payer_username,
        u.avatar_url AS payer_avatar,
        (bs.amount_owed - bs.amount_paid) AS amount_owed
      FROM bill_settlements bs
      JOIN bills b ON bs.bill_id = b.id
      JOIN users u ON bs.payer_clerk_id = u.clerk_id
      WHERE bs.payee_clerk_id = ${payeeClerkId}
        AND bs.status != 'paid'
      ORDER BY b.bill_date DESC, bs.id ASC
    `;

    // Group by bill_id
    const grouped = {};
    rows.forEach(row => {
      const billId = row.bill_id;
      if (!grouped[billId]) {
        grouped[billId] = {
          bill_id: billId,
          bill_name: row.bill_name,
          bill_date: row.bill_date,
          currency: row.currency,
          total_bill: parseFloat(row.total_bill) || 0,  // ✅ include total_bill
          payers: [],
        };
      }

      grouped[billId].payers.push({
        payer_clerk_id: row.payer_clerk_id,
        payer_username: row.payer_username,
        payer_avatar: row.payer_avatar,
        amount_owed: parseFloat(row.amount_owed),
      });
    });

    const result = Object.values(grouped);
    res.status(200).json({ bills: result });
  } catch (err) {
    console.error("getRequestsGroupedByBill error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}