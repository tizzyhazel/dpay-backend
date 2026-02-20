import express from "express";
import {
  getProfile,
  updateProfile,
  getPIN,
  updatePIN,
  createUser,
  checkUser,
} from "../controllers/profileController.js";

const router = express.Router();

// ------------------- PROFILE -------------------
router.get("/", getProfile);
router.put("/", updateProfile);

// ------------------- PIN -------------------
router.get("/pin", getPIN);
router.put("/pin", updatePIN);
router.post("/create", createUser); 
router.get("/check/:clerkId", checkUser);

export default router;
