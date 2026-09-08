import crypto from "crypto";
import prisma from "../config/db.js";

const hashSecret = (code) => crypto.createHash("sha256").update(code.trim()).digest("hex");

// POST /api/achievements/redeem
export const redeemWinnerCode = async (req, res) => {
  const userId = req.user.id;
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: "Winner redemption code is required." });
  }

  const codeHash = hashSecret(code);

  try {
    const achievement = await prisma.$transaction(async (tx) => {
      const winnerCode = await tx.winnerCode.findUnique({
        where: { codeHash },
        include: { event: true, history: true }
      });

      if (!winnerCode) {
        throw new Error("INVALID_CODE");
      }
      if (winnerCode.isRedeemed) {
        throw new Error("ALREADY_REDEEMED");
      }

      // Mark code as redeemed
      await tx.winnerCode.update({
        where: { id: winnerCode.id },
        data: {
          isRedeemed: true,
          redeemedByUserId: userId,
          redeemedAt: new Date()
        }
      });

      // Automatically generate the achievement record
      return await tx.achievement.create({
        data: {
          userId,
          eventId: winnerCode.eventId,
          historyId: winnerCode.historyId,
          winnerCodeId: winnerCode.id,
          position: winnerCode.positionTitle
        }
      });
    });

    res.status(201).json({
      message: "Congratulations! Achievement unlocked.",
      achievement
    });
  } catch (err) {
    if (err.message === "INVALID_CODE") return res.status(404).json({ error: "Invalid winner code." });
    if (err.message === "ALREADY_REDEEMED") return res.status(409).json({ error: "This code has already been redeemed." });
    res.status(500).json({ error: err.message });
  }
};

// GET /api/achievements/user/:userId
export const getUserAchievements = async (req, res) => {
  try {
    const { userId } = req.params;
    const achievements = await prisma.achievement.findMany({
      where: { userId },
      include: { event: { select: { title: true, eventDate: true } } }
    });
    res.json(achievements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};