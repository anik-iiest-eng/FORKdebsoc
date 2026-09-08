import express from "express";
import { 
  getEvents, 
  createEvent, 
  updateEvent,
  registerForEvent, 
  generateEventWinnerCodes 
} from "../controllers/event.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { requireAdmin } from "../middlewares/authorize.js";

const router = express.Router();

// Public read
router.get("/", getEvents);

// Public student registration (any authenticated IIEST user)
router.post("/:id/register", verifyToken, registerForEvent);

// Admin restricted endpoints
router.post("/", verifyToken, requireAdmin, createEvent);
router.put("/:id", verifyToken, requireAdmin, updateEvent);
router.post("/:id/winner-codes", verifyToken, requireAdmin, generateEventWinnerCodes);

export default router;