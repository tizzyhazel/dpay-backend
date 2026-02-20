import express from "express";
import { assignParticipants } from "../controllers/participantsController.js";

const router = express.Router({ mergeParams: true });

router.post("/", assignParticipants);

export default router;