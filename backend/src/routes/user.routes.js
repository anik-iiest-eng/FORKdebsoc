import express from "express";
import { body } from "express-validator";
import prisma from "../config/db.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";

const router = express.Router();

router.patch("/me/profile", verifyToken, [
	body("displayName").optional().isString().trim().isLength({ min: 2, max: 100 }),
	body("bio").optional({ nullable: true }).isString().isLength({ max: 2000 }),
	body("profileImage").optional({ nullable: true }).isURL({ protocols: ["http", "https"] }),
	body("bannerImage").optional({ nullable: true }).isURL({ protocols: ["http", "https"] }),
	body("spotifyLink").optional({ nullable: true }).isURL({ protocols: ["http", "https"] }),
	body("socialLinks").optional().isArray({ max: 20 }),
	body("socialLinks.*.label").optional().isString().trim().isLength({ min: 1, max: 40 }),
	body("socialLinks.*.url").optional().isURL({ protocols: ["http", "https"] })
], validate, async (req, res) => {
	try {
		const allowedFields = ["displayName", "bio", "profileImage", "bannerImage", "spotifyLink", "socialLinks"];
		const data = Object.fromEntries(
			allowedFields
				.filter((field) => Object.prototype.hasOwnProperty.call(req.body, field))
				.map((field) => [field, req.body[field]])
		);

		const updatedUser = await prisma.user.update({
			where: { id: req.user.id },
			data,
			select: {
				id: true,
				username: true,
				displayName: true,
				email: true,
				profileImage: true,
				bannerImage: true,
				spotifyLink: true,
				socialLinks: true,
				bio: true,
				selectedStyle: true,
				role: true
			}
		});

		return res.json({ user: updatedUser });
	} catch (error) {
		console.error("Profile update error:", error);
		return res.status(500).json({ error: "Failed to update profile." });
	}
});

router.get("/:username", async (req, res) => {
	try {
		const username = String(req.params.username || "").trim();
		if (!username) return res.status(400).json({ error: "Username is required." });

		const user = await prisma.user.findUnique({
			where: { username },
			select: {
				id: true,
				username: true,
				displayName: true,
				profileImage: true,
				bannerImage: true,
				spotifyLink: true,
				socialLinks: true,
				bio: true,
				selectedStyle: true,
				role: true,
				achievements: {
					orderBy: { awardedAt: "desc" },
					select: {
						id: true,
						position: true,
						awardedAt: true,
						event: { select: { title: true, eventDate: true } },
						history: { select: { title: true, eventDate: true } }
					}
				},
				_count: { select: { registrations: true, comments: true } }
			}
		});

		if (!user) return res.status(404).json({ error: "Profile not found." });

		res.json(user);
	} catch (error) {
		console.error("Profile lookup error:", error);
		res.status(500).json({ error: "Failed to load profile." });
	}
});

export default router;
