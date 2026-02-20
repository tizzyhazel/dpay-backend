// backend/routes/splittingRoute.js
import express from "express";
import {
  equalSplitExpense,
  customSplitExpense,
  generateBillSettlements,
} from "../controllers/splittingController.js";

const router = express.Router();

router.post("/bills/:billId/expenses/:expenseId/equal-split", equalSplitExpense);
router.post("/bills/:billId/expenses/:expenseId/custom-split", customSplitExpense);
router.post("/bills/:billId/generate-settlements", generateBillSettlements);

export default router;
