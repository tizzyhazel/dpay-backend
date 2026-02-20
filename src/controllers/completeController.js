import { sql } from "../config/db.js";

/**
 * Get all completed payments for the current user
 * Returns two arrays: oweMe (others paid me) and owedOthers (I paid others)
 */
export async function getCompletedOwedByUser(req, res) {
  try {
    const payerClerkId = req.headers["x-clerk-id"];
    if (!payerClerkId)
      return res.status(401).json({ message: "Unauthorized" });

    const rows = await sql`
      SELECT
        bs.bill_id,
        b.bill_name,
        b.bill_date,
        b.currency,
        b.total_bill,
        bs.payee_clerk_id,
        u.username AS payee_username,
        u.avatar_url AS payee_avatar,
        bs.amount_owed
      FROM bill_settlements bs
      JOIN bills b ON bs.bill_id = b.id
      JOIN users u ON bs.payee_clerk_id = u.clerk_id
      WHERE bs.payer_clerk_id = ${payerClerkId}
        AND bs.payer_clerk_id <> bs.payee_clerk_id
        AND b.status = 'completed'
      ORDER BY b.bill_date DESC, bs.id ASC
    `;

    const grouped = {};
    rows.forEach(row => {
      const billId = row.bill_id;
      if (!grouped[billId]) {
        grouped[billId] = {
          bill_id: billId,
          bill_name: row.bill_name,
          bill_date: row.bill_date,
          currency: row.currency,
          total_bill: parseFloat(row.total_bill) || 0,
          payees: [],
        };
      }

      grouped[billId].payees.push({
        payee_clerk_id: row.payee_clerk_id,
        payee_username: row.payee_username,
        payee_avatar: row.payee_avatar,
        amount_to_pay: parseFloat(row.amount_owed),
        currency: row.currency,
      });
    });

    res.status(200).json({ bills: Object.values(grouped) });
  } catch (err) {
    console.error("getCompletedOwedByUser error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Get all payments others owe me (payee perspective)
 */
export async function getCompletedOwedToUser(req, res) {
  try {
    const payeeClerkId = req.headers["x-clerk-id"];
    if (!payeeClerkId)
      return res.status(401).json({ message: "Unauthorized" });

    const rows = await sql`
      SELECT
        bs.bill_id,
        b.bill_name,
        b.bill_date,
        b.currency,
        b.total_bill,
        bs.payer_clerk_id,
        u.username AS payer_username,
        u.avatar_url AS payer_avatar,
        bs.amount_owed
      FROM bill_settlements bs
      JOIN bills b ON bs.bill_id = b.id
      JOIN users u ON bs.payer_clerk_id = u.clerk_id
      WHERE bs.payee_clerk_id = ${payeeClerkId}
        AND bs.payer_clerk_id <> bs.payee_clerk_id
        AND b.status = 'completed'
      ORDER BY b.bill_date DESC, bs.id ASC
    `;

    const grouped = {};
    rows.forEach(row => {
      const billId = row.bill_id;
      if (!grouped[billId]) {
        grouped[billId] = {
          bill_id: billId,
          bill_name: row.bill_name,
          bill_date: row.bill_date,
          currency: row.currency,
          total_bill: parseFloat(row.total_bill) || 0,
          payers: [],
        };
      }

      grouped[billId].payers.push({
        payer_clerk_id: row.payer_clerk_id,
        payer_username: row.payer_username,
        payer_avatar: row.payer_avatar,
        amount_owed: parseFloat(row.amount_owed),
        currency: row.currency,
      });
    });

    res.status(200).json({ bills: Object.values(grouped) });
  } catch (err) {
    console.error("getCompletedOwedToUser error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}