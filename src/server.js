import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDB } from "./config/db.js";
import rateLimiter from "./middleware/rateLimiter.js";
import friendsRoute from "./routes/friendsRoute.js";
import profileRoute from "./routes/profileRoute.js";
import billsRoute from "./routes/billsRoute.js";
import expensesRoute from "./routes/expensesRoute.js";
import participantsRoute from "./routes/participantsRoute.js";
import splittingRoute from "./routes/splittingRoute.js";
import requestRoute from "./routes/requestRoute.js";
import payRoute from "./routes/payRoute.js";
import completeRoute from "./routes/completeRoute.js";
import transactionsRoute from "./routes/transactionsRoute.js";
import job from "./config/cron.js";

dotenv.config();

const app = express();

// Start cron job in production
if (process.env.NODE_ENV === "production") job.start();

// ------------------- CORS -------------------
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "x-clerk-id"],
  })
);

// ------------------- MIDDLEWARE -------------------
app.use(rateLimiter);

// Increase body size to handle Base64 images
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: true }));

// ------------------- ROUTES -------------------
app.use("/api/friends", friendsRoute);
app.use("/api/profile", profileRoute);
app.use("/api/bills", billsRoute);
app.use("/api/bills/:billId/expenses", expensesRoute);     // add expenses
app.use("/api/bills/:billId/participants", participantsRoute);
app.use("/api/splitting", splittingRoute);  // assign participants
app.use("/api/requests", requestRoute);
app.use("/api/completed", completeRoute);
app.use("/api/pay", payRoute);

app.use("/api/transactions", transactionsRoute);

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ------------------- START SERVER -------------------
const PORT = process.env.PORT || 5001;

initDB().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
  console.log("Server is up and running on PORT:", PORT);
});
});
