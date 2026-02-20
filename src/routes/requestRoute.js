import express from "express";
import { getRequestsOwedToUser, getRequestsGroupedByBill } from "../controllers/requestController.js";

const router = express.Router();

// GET: list of requests where other users owe you
router.get("/", getRequestsOwedToUser);
router.get("/by-bill", getRequestsGroupedByBill);

export default router;