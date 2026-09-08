import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/history - Public endpoint for history page
router.get('/history', async (req, res) => {
  try {
    const archives = await prisma.history.findMany({
      orderBy: { eventDate: 'desc' },
      include: {
        achievements: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                username: true,
                profileImage: true,
                selectedStyle: true
              }
            }
          }
        }
      }
    });

    res.json(archives);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to retrieve archive history.' });
  }
});

export default router;