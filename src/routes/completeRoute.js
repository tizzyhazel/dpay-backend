import express from "express";
import { getCompletedOwedByUser,
  getCompletedOwedToUser, } from "../controllers/completeController.js";

const router = express.Router();

// GET: completed payments you owe others
router.get("/owed", getCompletedOwedByUser);

// GET: completed payments others owe you
router.get("/owed-to-me", getCompletedOwedToUser);

export default router;