import { sql } from "../config/db.js";

// ---------------- EQUAL SPLIT ----------------
// ---------------- EQUAL SPLIT ----------------
export async function equalSplitExpense(req, res) {
  const { expenseId } = req.params;
  const { participants } = req.body;

  const expense =
    (await sql`
      SELECT COALESCE(afteramount, amount) AS amount
      FROM expenses WHERE id = ${expenseId}
    `)[0];

  if (!expense) return res.status(404).json({ message: "Expense not found" });

  const splitAmount = Number(expense.amount) / participants.length;

  await sql`DELETE FROM expense_participants WHERE expense_id = ${expenseId}`;

  for (const clerkId of participants) {
    await sql`
      INSERT INTO expense_participants (expense_id, user_clerk_id, split_amount)
      VALUES (${expenseId}, ${clerkId}, ${splitAmount})
    `;
  }

  res.json({ message: "Equal split applied" });
}

// ---------------- CUSTOM SPLIT ----------------
export async function customSplitExpense(req, res) {
  try {
    const { expenseId } = req.params;
    const { splits } = req.body;

    if (!splits || Object.keys(splits).length === 0) {
      return res.status(400).json({ message: "Splits required" });
    }

    // Get expense amount (NUMERIC comes as string)
    const result = await sql`
      SELECT COALESCE(afteramount, amount) AS amount
      FROM expenses
      WHERE id = ${expenseId}
    `;

    if (!result.length) {
      return res.status(404).json({ message: "Expense not found" });
    }

    const expenseAmount = Number(result[0].amount);

    // Sum split amounts
    const splitTotal = Object.values(splits).reduce(
      (sum, val) => sum + Number(val),
      0
    );

    // Compare safely (2 decimal precision)
    if (splitTotal.toFixed(2) !== expenseAmount.toFixed(2)) {
      return res.status(400).json({
        message: "Split amounts do not sum to expense total",
      });
    }

    // Remove previous splits
    await sql`DELETE FROM expense_participants WHERE expense_id = ${expenseId}`;

    // Insert new splits
    for (const [clerkId, amount] of Object.entries(splits)) {
      await sql`
        INSERT INTO expense_participants (expense_id, user_clerk_id, split_amount)
        VALUES (${expenseId}, ${clerkId}, ${Number(amount)})
      `;
    }

    res.status(200).json({ message: "Custom split applied" });
  } catch (err) {
    console.error("customSplitExpense error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}


// ---------------- GENERATE SETTLEMENTS ----------------
export const generateBillSettlements = async (req, res) => {
  const { billId } = req.params;
  const { splits, currency } = req.body; // add currency

  try {
    if (!splits || Object.keys(splits).length === 0) {
      return res.status(400).json({ message: "No splits provided" });
    }

    // 1️⃣ Get bill creator
    const billRes = await sql`
      SELECT created_by_clerk_id
      FROM bills
      WHERE id = ${billId}
    `;
    if (!billRes.length) {
      return res.status(404).json({ message: "Bill not found" });
    }
    const creatorId = billRes[0].created_by_clerk_id;

    // 2️⃣ Clear old settlements
    await sql`DELETE FROM bill_settlements WHERE bill_id = ${billId}`;

    let totalBill = 0;
    let totalAmount = 0;
    const payerTotals = {}; // ✅ accumulate per payer

    // 3️⃣ Loop expenses → accumulate only
    for (const expenseId in splits) {
      const expenseRes = await sql`
        SELECT COALESCE(afteramount, amount) AS amount
        FROM expenses
        WHERE id = ${expenseId}
      `;

      const expenseAmount = parseFloat(expenseRes[0]?.amount ?? 0);
      totalBill += expenseAmount;

      const splitObj = splits[expenseId];

      for (const [clerkId, amount] of Object.entries(splitObj)) {
        const parsedAmount = parseFloat(amount);
        if (parsedAmount <= 0) continue;

        totalAmount += parsedAmount;

        payerTotals[clerkId] =
          (payerTotals[clerkId] ?? 0) + parsedAmount;
      }
    }

    // 4️⃣ Insert ONE settlement per payer
    for (const [clerkId, amount] of Object.entries(payerTotals)) {
      const roundedAmount = parseFloat(amount.toFixed(2));
      const isCreator = clerkId === creatorId;

      await sql`
        INSERT INTO bill_settlements
          (bill_id, payer_clerk_id, payee_clerk_id, amount_owed, amount_paid, status)
        VALUES
          (
            ${billId},
            ${clerkId},
            ${creatorId},
            ${roundedAmount},
            ${isCreator ? roundedAmount : 0},
            ${isCreator ? 'paid' : 'unpaid'}
          )
      `;
    }

    // 5️⃣ Update bill totals AND currency
    totalBill = parseFloat(totalBill.toFixed(2));
    totalAmount = parseFloat(totalAmount.toFixed(2));
    const totalNet = parseFloat((totalAmount - totalBill).toFixed(2));

    await sql`
      UPDATE bills
      SET total_bill = ${totalBill},
          total_amount = ${totalAmount},
          total_net = ${totalNet},
          currency = ${currency ?? 'RM'}
      WHERE id = ${billId}
    `;

    res.json({
      message: "Bill settlements generated successfully",
      total_bill: totalBill.toFixed(2),
      total_amount: totalAmount.toFixed(2),
      total_net: totalNet.toFixed(2),
      currency: currency ?? 'RM',
    });
  } catch (err) {
    console.error("generateBillSettlements error:", err);
    res.status(500).json({ message: "Failed to generate settlements" });
  }
};
