import express from "express";
import { getPaymentsByUser, getPaymentsGroupedByBill } from "../controllers/payController.js";

const router = express.Router();

// GET: list of payments where current user owes others
router.get("/", getPaymentsByUser);
router.get("/by-bill", getPaymentsGroupedByBill);

export default router;