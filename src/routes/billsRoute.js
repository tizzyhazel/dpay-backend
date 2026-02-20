// backend/routes/billsRoute.js
import express from "express";
import {
  createBill,
  getBillParticipantsCandidates,
  getBillDetails,
  getBillWithTotals,

  // payment request / settlement
  requestPayment,
  requestAllPayments,
  settlePayment,
  settleAllPayments,

  // approvals
  getPendingApprovals,
  approvePayment,
  approveAllPayments,

  // receipt
  getBillReceipt,

  // delete
  deleteBill,
  deleteHardBill,

  togglePaymentVisibility,

  payBill,
  getUnpaidParticipants,
} from "../controllers/billsController.js";

const router = express.Router();

// Simple create bill
router.post("/", createBill);
router.get("/participants", getBillParticipantsCandidates);
router.get("/:billId/details", getBillDetails);
router.get("/:billId/with-totals", getBillWithTotals);
router.get("/:billId/unpaid", getUnpaidParticipants);
router.post("/:billId/request", requestPayment);
router.post("/:billId/request-all", requestAllPayments);
router.post("/:billId/settle", settlePayment);      // new
router.post("/:billId/settle-all", settleAllPayments); 

router.get("/:billId/pending-approvals", getPendingApprovals);
router.post("/:billId/approve", approvePayment);
router.post("/:billId/approve-all", approveAllPayments);
router.delete('/:billId', deleteBill);

router.get("/:billId/receipt", getBillReceipt);

router.patch(
  "/:billId/payment-visibility",
  togglePaymentVisibility
);

router.post("/:billId/pay", payBill); // <-- new

router.delete('/:billId/hard', deleteHardBill);

export default router;
