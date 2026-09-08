import express from "express";
import { body } from "express-validator";
import { redeemWinnerCode, getUserAchievements } from "../controllers/achievement.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";

const router = express.Router();

router.post("/redeem", verifyToken, [
	body("code").isString().trim().isLength({ min: 6, max: 100 })
], validate, redeemWinnerCode);
router.get("/user/:userId", getUserAchievements);

export default router;