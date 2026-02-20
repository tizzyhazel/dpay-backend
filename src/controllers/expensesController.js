import { sql } from "../config/db.js";

// Add expense to a bill
export async function addExpense(req, res) {
  try {
    const { billId } = req.params;
    const { expense_name, expense_date, description, amount, currency = "RM" } = req.body;

    if (!expense_name || amount === undefined || amount === null) {
      return res.status(400).json({ message: "expense_name and amount are required" });
    }

    const insertedExpenses = await sql`
      INSERT INTO expenses (
        bill_id,
        expense_name,
        expense_date,
        description,
        amount,
        currency,
        afteramount,
        aftercurrency,
        rate
      )
      VALUES (
        ${billId},
        ${expense_name},
        ${expense_date || null},
        ${description || null},
        ${amount},
        ${currency},
        NULL,
        NULL,
        NULL
      )
      RETURNING *
    `;

    res.status(201).json(insertedExpenses[0]);
  } catch (error) {
    console.error("addExpense error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function convertExpense(req, res) {
  try {
    const { expenseId } = req.params;
    const { rate, aftercurrency } = req.body;

    if (!rate || !aftercurrency) {
      return res.status(400).json({ message: "rate and aftercurrency are required" });
    }

    // Fetch current expense
    const expenseRes = await sql`
      SELECT amount, currency
      FROM expenses
      WHERE id = ${expenseId}
    `;
    const expense = expenseRes[0];
    if (!expense) return res.status(404).json({ message: "Expense not found" });

    // Calculate after conversion
    const afteramount = parseFloat(expense.amount) * parseFloat(rate);

    // Update expense
    const updated = await sql`
      UPDATE expenses
      SET afteramount = ${afteramount},
          aftercurrency = ${aftercurrency},
          rate = ${rate}
      WHERE id = ${expenseId}
      RETURNING *
    `;

    res.status(200).json(updated[0]);
  } catch (err) {
    console.error("convertExpense error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function deleteExpense(req, res) {
  try {
    const { expenseId } = req.params;

    // Check if expense exists
    const expenseRes = await sql`
      SELECT id FROM expenses WHERE id = ${expenseId}
    `;
    if (!expenseRes[0]) return res.status(404).json({ message: "Expense not found" });

    // Delete expense
    await sql`
      DELETE FROM expenses WHERE id = ${expenseId}
    `;

    res.status(200).json({ message: "Expense deleted successfully" });
  } catch (err) {
    console.error("deleteExpense error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};