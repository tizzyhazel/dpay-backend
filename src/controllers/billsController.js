// backend/controllers/billsController.js
import { sql } from "../config/db.js";

export async function createBill(req, res) {
  try {
    const creatorClerkId = req.headers["x-clerk-id"];
    const { bill_name, bill_date, description, participants = [] } = req.body;

    if (!bill_name || !bill_date) {
      return res.status(400).json({ message: "bill_name and bill_date required" });
    }

    if (!creatorClerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 1️⃣ Insert bill
    const insertedBills = await sql`
      INSERT INTO bills (bill_name, bill_date, description, created_by_clerk_id)
      VALUES (${bill_name}, ${bill_date}, ${description || ''}, ${creatorClerkId})
      RETURNING *
    `;
    const bill = insertedBills[0];

    // 2️⃣ Insert creator as participant
    await sql`
      INSERT INTO bill_participants (bill_id, user_clerk_id)
      VALUES (${bill.id}, ${creatorClerkId})
      ON CONFLICT DO NOTHING
    `;

    // 3️⃣ Insert other participants
    const participantIds = participants.map(p => p.clerk_id); // extract IDs
    for (const participantId of participantIds) {
      if (participantId === creatorClerkId) continue;
      await sql`
        INSERT INTO bill_participants (bill_id, user_clerk_id)
        VALUES (${bill.id}, ${participantId})
        ON CONFLICT DO NOTHING
      `;
    }

    // 4️⃣ Fetch participants for response
    const billParticipants = await sql`
      SELECT bp.user_clerk_id, u.username, u.display_name, u.avatar_url
      FROM bill_participants bp
      JOIN users u ON bp.user_clerk_id = u.clerk_id
      WHERE bp.bill_id = ${bill.id}
    `;

    res.status(201).json({
      bill,
      participants: billParticipants,
      message: "Bill created successfully!"
    });
  } catch (error) {
    console.error("createBill error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getBillParticipantsCandidates(req, res) {
  try {
    const clerkId = req.headers["x-clerk-id"];
    if (!clerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const friends = await sql`
      SELECT 
        u.clerk_id,
        u.username,
        u.avatar_url
      FROM friendships f
      JOIN users u
        ON (
          (f.requester_clerk_id = ${clerkId} AND f.receiver_clerk_id = u.clerk_id)
          OR
          (f.receiver_clerk_id = ${clerkId} AND f.requester_clerk_id = u.clerk_id)
        )
      WHERE f.status = 'accepted'
      ORDER BY u.username
    `;

    res.status(200).json(friends);
  } catch (error) {
    console.error("getBillParticipantsCandidates error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getBillDetails(req, res) {
  try {
    const { billId } = req.params;

    // 1️⃣ Get bill info
    const billRes = await sql`
      SELECT * FROM bills WHERE id = ${billId}
    `;
    const bill = billRes[0];
    if (!bill) return res.status(404).json({ message: "Bill not found" });

    // 2️⃣ Get expenses
    const expenses = await sql`
      SELECT id, expense_name, amount, currency, afteramount, aftercurrency
      FROM expenses
      WHERE bill_id = ${billId}
    `;

    // 3️⃣ Calculate totals grouped by currency
    const totals = {};
    expenses.forEach((e) => {
      const currency = e.currency || 'RM';
      const amount = parseFloat(e.amount || 0);
      if (!totals[currency]) totals[currency] = 0;
      totals[currency] += amount;
    });

    // 4️⃣ Get participants
    const participants = await sql`
      SELECT u.clerk_id, u.username, u.avatar_url
      FROM bill_participants bp
      JOIN users u ON bp.user_clerk_id = u.clerk_id
      WHERE bp.bill_id = ${billId}
    `;

    res.status(200).json({ bill, expenses, participants, totals });
  } catch (err) {
    console.error("getBillDetails error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getBillWithTotals(req, res) {
  try {
    const { billId } = req.params;

    // 1️⃣ Get bill info with creator, but ignore deleted bills
    const billRes = await sql`
      SELECT b.*, 
             u.username AS creator_name, 
             u.avatar_url AS creator_avatar_url, 
             u.clerk_id AS creator_clerk_id
      FROM bills b
      JOIN users u ON b.created_by_clerk_id = u.clerk_id
      WHERE b.id = ${billId} AND b.is_deleted = false
    `;
    const bill = billRes[0];
    if (!bill) return res.status(404).json({ message: "Bill not found or has been deleted" });

    // 2️⃣ Get expenses for this bill
    const expenses = await sql`
      SELECT id, expense_name, amount, currency, afteramount, aftercurrency
      FROM expenses
      WHERE bill_id = ${billId}
      ORDER BY id
    `;

    // 3️⃣ Get participants with their settlement info
    const participants = await sql`
      SELECT u.clerk_id, u.username, u.avatar_url,
             COALESCE(bs.amount_owed, 0) AS amount_owed,
             COALESCE(bs.amount_paid, 0) AS amount_paid,
             COALESCE(bs.status, 'unpaid') AS status
      FROM bill_participants bp
      JOIN users u ON bp.user_clerk_id = u.clerk_id
      LEFT JOIN bill_settlements bs
        ON bs.bill_id = bp.bill_id AND bs.payer_clerk_id = u.clerk_id
      WHERE bp.bill_id = ${billId}
    `;

    // 4️⃣ Get splits for each expense
    const splitData = {};
    for (const expense of expenses) {
      const splits = await sql`
        SELECT user_clerk_id, split_amount
        FROM expense_participants
        WHERE expense_id = ${expense.id}
      `;
      splitData[expense.id] = {};
      splits.forEach(s => {
        splitData[expense.id][s.user_clerk_id] = parseFloat(s.split_amount);
      });
    }

    // 5️⃣ Compute total per participant from splits
    const participantTotals = {};
    participants.forEach(p => (participantTotals[p.clerk_id] = 0));
    Object.values(splitData).forEach(expenseSplit => {
      Object.entries(expenseSplit).forEach(([clerkId, amount]) => {
        participantTotals[clerkId] += Number(amount);
      });
    });

    // 6️⃣ Compute total bill amount (optional, sums all afteramount or amount)
    const totalAmount = expenses.reduce(
      (sum, e) => sum + Number(e.afteramount ?? e.amount ?? 0),
      0
    );

    res.json({
      bill,
      expenses,
      participants, 
      splitData,
      participantTotals,
      totalAmount,
    });
  } catch (err) {
    console.error("getBillWithTotals error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getUnpaidParticipants(req, res) {
  try {
    const { billId } = req.params;

    const unpaid = await sql`
      SELECT u.clerk_id, u.username, u.avatar_url,
             COALESCE(bs.amount_owed, 0) AS amount_owed,
             COALESCE(bs.amount_paid, 0) AS amount_paid,
             COALESCE(bs.status, 'unpaid') AS status
      FROM bill_participants bp
      JOIN users u ON bp.user_clerk_id = u.clerk_id
      LEFT JOIN bill_settlements bs
        ON bs.bill_id = bp.bill_id AND bs.payer_clerk_id = u.clerk_id
      WHERE bp.bill_id = ${billId} AND COALESCE(bs.status, 'unpaid') != 'paid'
        AND u.clerk_id != (SELECT created_by_clerk_id FROM bills WHERE id = ${billId})
    `;

    res.json(unpaid);
  } catch (err) {
    console.error("getUnpaidParticipants error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function requestPayment(req, res) {
  try {
    const requesterClerkId = req.headers["x-clerk-id"];
    const { billId } = req.params;
    const { payer_clerk_id, amount } = req.body;

    if (!requesterClerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!payer_clerk_id || !amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid request data" });
    }

    const billRes = await sql`
      SELECT * FROM bills WHERE id = ${billId}
    `;
    const bill = billRes[0];

    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    if (bill.created_by_clerk_id !== requesterClerkId) {
      return res.status(403).json({ message: "Only creator can request payment" });
    }

    const existingSettlement = await sql`
      SELECT status FROM bill_settlements
      WHERE bill_id = ${billId} AND payer_clerk_id = ${payer_clerk_id}
    `;

    if (existingSettlement.length > 0 && existingSettlement[0].status === 'paid') {
      return res.status(200).json({ 
        message: "Payment already settled for this participant" 
      });
    }

    await sql`
      INSERT INTO bill_settlements (
        bill_id,
        payer_clerk_id,
        payee_clerk_id,
        amount_owed,
        amount_paid,
        status
      )
      VALUES (
        ${billId},
        ${payer_clerk_id},
        ${requesterClerkId},
        ${amount},
        0,
        'unpaid'::payment_status
      )
      ON CONFLICT (bill_id, payer_clerk_id)
      DO UPDATE SET
        amount_owed = EXCLUDED.amount_owed,
        amount_paid = CASE 
          WHEN bill_settlements.status = 'paid' THEN bill_settlements.amount_paid
          ELSE 0
        END,
        status = CASE 
          WHEN bill_settlements.status = 'paid' THEN bill_settlements.status
          ELSE 'unpaid'::payment_status
        END,
        updated_at = now()
    `;

    res.status(200).json({ message: "Payment request sent" });
  } catch (error) {
    console.error("requestPayment error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function requestAllPayments(req, res) {
  try {
    const requesterClerkId = req.headers["x-clerk-id"];
    const { billId } = req.params;
    const { participantTotals } = req.body; 

    if (!requesterClerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const billRes = await sql`
      SELECT * FROM bills WHERE id = ${billId}
    `;
    const bill = billRes[0];

    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    if (bill.created_by_clerk_id !== requesterClerkId) {
      return res.status(403).json({ message: "Only creator can request payment" });
    }

    for (const [payerClerkId, amount] of Object.entries(participantTotals)) {
      if (amount <= 0) continue;
      if (payerClerkId === requesterClerkId) continue;

      // Check if already paid
      const existingSettlement = await sql`
        SELECT status FROM bill_settlements
        WHERE bill_id = ${billId} AND payer_clerk_id = ${payerClerkId}
      `;

      // Skip if already paid
      if (existingSettlement.length > 0 && existingSettlement[0].status === 'paid') {
        continue;
      }

      await sql`
        INSERT INTO bill_settlements (
          bill_id,
          payer_clerk_id,
          payee_clerk_id,
          amount_owed,
          amount_paid,
          status
        )
        VALUES (
          ${billId},
          ${payerClerkId},
          ${requesterClerkId},
          ${amount},
          0,
          'unpaid'
        )
        ON CONFLICT (bill_id, payer_clerk_id)
        DO UPDATE SET
          amount_owed = EXCLUDED.amount_owed,
          amount_paid = CASE 
            WHEN bill_settlements.status = 'paid' THEN bill_settlements.amount_paid
            ELSE 0
          END,
          status = CASE 
            WHEN bill_settlements.status = 'paid' THEN bill_settlements.status
            ELSE 'unpaid'::payment_status
          END,
          updated_at = now()
      `;
    }

    res.status(200).json({ message: "Requests sent to all participants" });
  } catch (error) {
    console.error("requestAllPayments error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function settlePayment(req, res) {
  try {
    const creatorClerkId = req.headers["x-clerk-id"];
    const { billId } = req.params;
    const { payer_clerk_id } = req.body;

    if (!creatorClerkId) return res.status(401).json({ message: "Unauthorized" });
    if (!payer_clerk_id) return res.status(400).json({ message: "payer_clerk_id required" });

    // Verify bill & creator
    const billRes = await sql`SELECT * FROM bills WHERE id = ${billId}`;
    const bill = billRes[0];
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    if (bill.created_by_clerk_id !== creatorClerkId)
      return res.status(403).json({ message: "Only creator can settle payments" });

    // Update settlement to paid
    await sql`
      UPDATE bill_settlements
      SET status = 'paid', amount_paid = amount_owed, updated_at = now()
      WHERE bill_id = ${billId} AND payer_clerk_id = ${payer_clerk_id}
    `;

    // Check if all participants are now paid
    const unpaid = await sql`
      SELECT COUNT(*)::int AS unpaid_count
      FROM bill_settlements
      WHERE bill_id = ${billId} AND status != 'paid'
    `;
    if (unpaid[0].unpaid_count === 0) {
      await sql`UPDATE bills SET status = 'completed', updated_at = now() WHERE id = ${billId}`;
    }

    res.json({ message: "Payment settled" });
  } catch (err) {
    console.error("settlePayment error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Settle all unpaid participants
export async function settleAllPayments(req, res) {
  try {
    const creatorClerkId = req.headers["x-clerk-id"];
    const { billId } = req.params;

    if (!creatorClerkId) return res.status(401).json({ message: "Unauthorized" });

    // Verify bill & creator
    const billRes = await sql`SELECT * FROM bills WHERE id = ${billId}`;
    const bill = billRes[0];
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    if (bill.created_by_clerk_id !== creatorClerkId)
      return res.status(403).json({ message: "Only creator can settle payments" });

    // Update all unpaid settlements to paid
    await sql`
      UPDATE bill_settlements
      SET status = 'paid', amount_paid = amount_owed, updated_at = now()
      WHERE bill_id = ${billId} AND status != 'paid'
    `;

    // Mark bill as completed
    await sql`UPDATE bills SET status = 'completed', updated_at = now() WHERE id = ${billId}`;

    res.json({ message: "All payments settled" });
  } catch (err) {
    console.error("settleAllPayments error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getPendingApprovals(req, res) {
  try {
    const { billId } = req.params;
    const clerkId = req.headers["x-clerk-id"];
    if (!clerkId) return res.status(401).json({ message: "Unauthorized" });

    const pending = await sql`
      SELECT 
        bs.payer_clerk_id,
        bs.payee_clerk_id,
        bs.amount_owed,
        bs.amount_paid,
        bs.status,
        u.username,
        u.avatar_url
      FROM bill_settlements bs
      JOIN users u ON bs.payer_clerk_id = u.clerk_id
      WHERE bs.bill_id = ${billId} AND bs.status = 'pending'
    `;

    res.status(200).json(pending);
  } catch (err) {
    console.error("getPendingApprovals error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Approve one pending participant
export async function approvePayment(req, res) {
  try {
    const { billId } = req.params;
    const { payer_clerk_id } = req.body;
    const clerkId = req.headers["x-clerk-id"];
    if (!clerkId) return res.status(401).json({ message: "Unauthorized" });

    const updated = await sql`
      UPDATE bill_settlements
      SET status = 'paid', amount_paid = amount_owed, updated_at = now()
      WHERE bill_id = ${billId}
        AND payer_clerk_id = ${payer_clerk_id}
        AND status = 'pending'
      RETURNING *
    `;

    if (updated.length === 0) {
      return res.status(400).json({ message: "No pending payment found for this participant" });
    }

    // ✅ CHECK IF ALL PARTICIPANTS ARE PAID
    const unpaid = await sql`
      SELECT COUNT(*)::int AS unpaid_count
      FROM bill_settlements
      WHERE bill_id = ${billId} AND status != 'paid'
    `;

    if (unpaid[0].unpaid_count === 0) {
      await sql`
        UPDATE bills
        SET status = 'completed', updated_at = now()
        WHERE id = ${billId}
      `;
    }

    res.status(200).json({
      message: "Approved successfully",
      settlement: updated[0],
    });
  } catch (err) {
    console.error("approvePayment error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}


// Approve ALL pending participants
export async function approveAllPayments(req, res) {
  try {
    const { billId } = req.params;
    const clerkId = req.headers["x-clerk-id"];
    if (!clerkId) return res.status(401).json({ message: "Unauthorized" });

    const updated = await sql`
      UPDATE bill_settlements
      SET status = 'paid', amount_paid = amount_owed, updated_at = now()
      WHERE bill_id = ${billId} AND status = 'pending'
      RETURNING *
    `;

    if (updated.length === 0) {
      return res.status(400).json({ message: "No pending payments to approve" });
    }

    // ✅ FORCE BILL TO COMPLETED
    await sql`
      UPDATE bills
      SET status = 'completed', updated_at = now()
      WHERE id = ${billId}
    `;

    res.status(200).json({
      message: "All pending payments approved",
      settlements: updated,
    });
  } catch (err) {
    console.error("approveAllPayments error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export const deleteBill = async (req, res) => {
  const { billId } = req.params;

  try {
    console.log("💡 Delete request received for billId:", billId);

    // Fetch bill first
    const billRes = await sql`SELECT * FROM bills WHERE id = ${billId}`;
    const bill = billRes[0];

    console.log("💡 Fetched bill:", bill);

    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    // Only allow deletion if completed
    if (bill.status.toLowerCase() !== "completed") {
      return res.status(400).json({ message: "Only completed bills can be deleted" });
    }

    // Soft delete: mark is_deleted
    await sql`
      UPDATE bills
      SET is_deleted = TRUE, updated_at = now()
      WHERE id = ${billId}
    `;

    console.log("✅ Bill soft-deleted:", billId);

    return res.status(200).json({ message: "Bill deleted successfully (soft delete)" });
  } catch (err) {
    console.error("❌ deleteBill error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getBillReceipt = async (req, res) => {
  const { billId } = req.params;

  try {
    /* ================= BILL INFO ================= */
    const billRes = await sql`
      SELECT 
        b.bill_name,
        TO_CHAR(b.bill_date, 'YYYY-MM-DD') AS bill_date,  -- format date as string
        b.status,
        b.currency,
        b.total_bill,
        b.total_amount,
        b.total_net,
        u.username AS created_by
      FROM bills b
      JOIN users u ON u.clerk_id = b.created_by_clerk_id
      WHERE b.id = ${billId}
    `;

    if (billRes.length === 0) {
      return res.status(404).json({ message: "Bill not found" });
    }

    const bill = billRes[0];

    /* ================= PARTICIPANTS ================= */
    const participantsRes = await sql`
      SELECT 
        u.username,
        bs.amount_owed,
        bs.status
      FROM bill_settlements bs
      JOIN users u ON u.clerk_id = bs.payer_clerk_id
      WHERE bs.bill_id = ${billId}
      ORDER BY u.username
    `;

    const participants = participantsRes.map(p => ({
      username: p.username,
      amount: Number(p.amount_owed),
      status: p.status, // paid | unpaid | pending
    }));

    /* ================= EXPENSES ================= */
    const expensesRes = await sql`
      SELECT 
        e.id,
        e.expense_name,
        e.amount,
        e.currency,
        e.afteramount,
        e.aftercurrency,
        e.rate
      FROM expenses e
      WHERE e.bill_id = ${billId}
      ORDER BY e.id
    `;

    const expenses = [];

    for (const e of expensesRes) {
      const splits = await sql`
        SELECT 
          u.username,
          ep.split_amount
        FROM expense_participants ep
        JOIN users u ON u.clerk_id = ep.user_clerk_id
        WHERE ep.expense_id = ${e.id}
        ORDER BY u.username
      `;

      expenses.push({
        id: e.id,
        name: e.expense_name,
        original: {
          amount: Number(e.amount),
          currency: e.currency,
        },
        converted: e.afteramount
          ? {
              amount: Number(e.afteramount),
              currency: e.aftercurrency,
              rate: Number(e.rate),
            }
          : null,
        splitWith: splits.map(s => ({
          username: s.username,
          share: Number(s.split_amount),
        })),
      });
    }

    /* ================= RESPONSE ================= */
    res.json({
      bill: {
        name: bill.bill_name,
        createdBy: bill.created_by,
        date: bill.bill_date,
        status: bill.status,
        currency: bill.currency,
        total_bill: Number(bill.total_bill),       // use stored value
        total_split: Number(bill.total_amount),    // use stored value
        net: Number(bill.total_net),               // use stored value
      },
      participants,
      expenses,
    });
  } catch (err) {
    console.error("getBillReceipt error:", err);
    res.status(500).json({ message: "Failed to load bill receipt" });
  }
};

export async function togglePaymentVisibility(req, res) {
  try {
    const clerkId = req.headers["x-clerk-id"];
    const { billId } = req.params;
    const { is_visible } = req.body;

    if (!clerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const billRes = await sql`
      SELECT * FROM bills WHERE id = ${billId}
    `;
    const bill = billRes[0];

    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    if (bill.created_by_clerk_id !== clerkId) {
      return res.status(403).json({ message: "Only creator can toggle payment visibility" });
    }

    await sql`
      UPDATE bills
      SET is_visible = ${is_visible}, updated_at = now()
      WHERE id = ${billId}
    `;

    res.json({
      message: "Payment visibility updated",
      is_visible,
    });
  } catch (err) {
    console.error("togglePaymentVisibility error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function getIndividualPayList(req, res) {
  try {
    const clerkId = req.headers["x-clerk-id"];
    if (!clerkId) return res.status(401).json({ message: "Unauthorized" });

    // 1️⃣ Get all settlements where current user is the payee
    const settlements = await sql`
      SELECT 
        u.clerk_id,
        u.username,
        u.avatar_url,
        bs.amount_owed,
        bs.currency
      FROM bill_settlements bs
      JOIN users u ON u.clerk_id = bs.payer_clerk_id
      WHERE bs.payee_clerk_id = ${clerkId} AND bs.status != 'paid'
      ORDER BY u.username
    `;

    // 2️⃣ Aggregate totals by currency (optional for header)
    const totalsByCurrency = {};
    settlements.forEach(s => {
      const currency = s.currency || 'RM';
      totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + Number(s.amount_owed);
    });

    // 3️⃣ Map to frontend-friendly format
    const individualList = settlements.map(s => ({
      clerk_id: s.clerk_id,
      username: s.username,
      avatar_url: s.avatar_url,
      currency: s.currency || 'RM',
      total: Number(s.amount_owed),
    }));

    res.json({ individualList, totalsByCurrency });
  } catch (err) {
    console.error("getIndividualPayList error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function payBill(req, res) {
  try {
    const payerClerkId = req.headers["x-clerk-id"]; // the user who is paying
    const { billId } = req.params;

    if (!payerClerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Check if bill exists and is visible
    const billRes = await sql`SELECT * FROM bills WHERE id = ${billId}`;
    const bill = billRes[0];
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    if (!bill.is_visible) {
      return res.status(403).json({ message: "Bill is not open for payment" });
    }

    // Check if user is a participant
    const participantRes = await sql`
      SELECT * FROM bill_participants
      WHERE bill_id = ${billId} AND user_clerk_id = ${payerClerkId}
    `;
    if (!participantRes[0]) {
      return res.status(403).json({ message: "You are not a participant of this bill" });
    }

    // Get the participant's settlement
    const settlementRes = await sql`
      SELECT * FROM bill_settlements
      WHERE bill_id = ${billId} AND payer_clerk_id = ${payerClerkId}
    `;
    const settlement = settlementRes[0];

    if (!settlement) {
      return res.status(404).json({ message: "No settlement found for this user" });
    }

    if (settlement.status === "paid") {
      return res.status(400).json({ message: "You have already paid this bill" });
    }

    if (settlement.status === "pending") {
      return res.status(400).json({ message: "Payment is already pending" });
    }

    // Update status to pending
    await sql`
      UPDATE bill_settlements
      SET status = 'pending'::payment_status, updated_at = now()
      WHERE bill_id = ${billId} AND payer_clerk_id = ${payerClerkId}
    `;

    res.status(200).json({
      message: "Payment marked as pending",
      amount: settlement.amount_owed,
    });
  } catch (error) {
    console.error("payBill error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function deleteHardBill(req, res) {
  try {
    const { billId } = req.params;
    const clerkId = req.headers["x-clerk-id"];

    if (!clerkId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 1️⃣ Check if bill exists
    const billRes = await sql`
      SELECT * FROM bills WHERE id = ${billId}
    `;
    const bill = billRes[0];

    if (!bill) {
      return res.status(404).json({ message: "Bill not found" });
    }

    // Optional: Only allow creator to delete
    if (bill.created_by_clerk_id !== clerkId) {
      return res.status(403).json({ message: "You are not allowed to delete this bill" });
    }

    // 2️⃣ Delete related data (expenses, expense_participants, bill_participants)
    await sql`DELETE FROM expense_participants WHERE expense_id IN (
        SELECT id FROM expenses WHERE bill_id = ${billId}
    )`;
    await sql`DELETE FROM expenses WHERE bill_id = ${billId}`;
    await sql`DELETE FROM bill_participants WHERE bill_id = ${billId}`;

    // 3️⃣ Delete the bill itself
    await sql`DELETE FROM bills WHERE id = ${billId}`;

    // ✅ Response
    res.json({ message: "Bill deleted successfully (hard delete)" });
  } catch (err) {
    console.error("deleteHardBill error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}