import express from "express";
import {
  searchUsers,
  sendRequest,
  acceptRequest,
  cancelRequest,
  getIncoming,
  getOutgoing,
  getFriends,
} from '../controllers/friendsController.js';

const router = express.Router();

router.get("/search", searchUsers);
router.post("/request", sendRequest);
router.post("/accept", acceptRequest);
router.post("/cancel", cancelRequest);
router.get("/incoming", getIncoming);
router.get("/outgoing", getOutgoing);
router.get("/myfriends", getFriends);


export default router;
