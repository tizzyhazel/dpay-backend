import { sql } from "../config/db.js";

/**
 * Get all bills where the current user owes other users
 * Aggregated per payee (friend)
 */
export async function getPaymentsByUser(req, res) {
  try {
    const payerClerkId = req.headers["x-clerk-id"];
    if (!payerClerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Aggregate settlements per payee, grouped by currency
    const settlements = await sql`
      SELECT 
        bs.payee_clerk_id,
        u.username AS payee_username,
        u.avatar_url AS payee_avatar,
        b.currency,
        SUM(bs.amount_owed - bs.amount_paid) AS total_to_pay
      FROM bill_settlements bs
      JOIN users u ON bs.payee_clerk_id = u.clerk_id
      JOIN bills b ON bs.bill_id = b.id
      WHERE bs.payer_clerk_id = ${payerClerkId}
        AND bs.status != 'paid'
      GROUP BY bs.payee_clerk_id, u.username, u.avatar_url, b.currency
      ORDER BY u.username, b.currency
    `;

    // Group by payee_clerk_id to create multiple currency amounts per friend
    const grouped = {};
    settlements.forEach(s => {
      const id = s.payee_clerk_id;
      if (!grouped[id]) {
        grouped[id] = {
          payee_clerk_id: id,
          payee_username: s.payee_username,
          payee_avatar: s.payee_avatar,
          amounts: [], // array of { currency, total_to_pay }
        };
      }

      grouped[id].amounts.push({
        currency: s.currency,
        total_to_pay: parseFloat(s.total_to_pay),
      });
    });

    const result = Object.values(grouped);
    res.status(200).json({ payments: result });
  } catch (err) {
    console.error("getPaymentsByUser error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Get all bills where the current user owes other users
 * Grouped by bill
 */
export async function getPaymentsGroupedByBill(req, res) {
  try {
    const payerClerkId = req.headers["x-clerk-id"];
    if (!payerClerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Fetch all settlements for this user with bill info, including total_bill
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
        (bs.amount_owed - bs.amount_paid) AS amount_to_pay
      FROM bill_settlements bs
      JOIN bills b ON bs.bill_id = b.id
      JOIN users u ON bs.payee_clerk_id = u.clerk_id
      WHERE bs.payer_clerk_id = ${payerClerkId}
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
          total_bill: parseFloat(row.total_bill) || 0,
          payees: [],
        };
      }

      grouped[billId].payees.push({
        payee_clerk_id: row.payee_clerk_id,
        payee_username: row.payee_username,
        payee_avatar: row.payee_avatar,
        amount_to_pay: parseFloat(row.amount_to_pay),
      });
    });

    const result = Object.values(grouped);
    res.status(200).json({ bills: result });
  } catch (err) {
    console.error("getPaymentsGroupedByBill error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
