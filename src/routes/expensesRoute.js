import express from "express";
import { addExpense, convertExpense, deleteExpense } from "../controllers/expensesController.js";

const router = express.Router({ mergeParams: true }); // mergeParams to get billId from parent

router.post("/", addExpense);
router.put("/:expenseId/convert", convertExpense);
router.delete("/:expenseId", deleteExpense);

export default router;