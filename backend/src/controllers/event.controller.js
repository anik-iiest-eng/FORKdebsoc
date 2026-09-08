import prisma from "../config/db.js";
import crypto from "crypto";

// Helper: Secure code generation + SHA-256 hash
const generateCode = () => `DEB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const hashSecret = (code) => crypto.createHash("sha256").update(code.trim()).digest("hex");
// PUT /api/events/:id (Admin only)
export const updateEvent = async (req, res) => {
  const { id: eventId } = req.params;
  const { title, description, eventDate, registrationDeadline, location, coverImage } = req.body;

  try {
    const existing = await prisma.event.findUnique({ where: { id: eventId } });
    if (!existing) {
      return res.status(404).json({ error: "Event not found." });
    }

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        ...(title && { title }),
        ...(description && { description }),
        ...(eventDate && { eventDate: new Date(eventDate) }),
        ...(registrationDeadline && { registrationDeadline: new Date(registrationDeadline) }),
        ...(location && { location }),
        ...(coverImage && { coverImage })
      }
    });

    res.json({ message: "Event updated successfully", event: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// POST /api/events/:id/winner-codes
export const generateEventWinnerCodes = async (req, res) => {
  const { id: eventId } = req.params;
  const { titles } = req.body; // e.g. ["1st Place", "2nd Place", "Best Speaker"]

  if (!titles || !Array.isArray(titles) || titles.length === 0) {
    return res.status(400).json({ error: "Please provide an array of award titles." });
  }

  try {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ error: "Event not found." });

    const codeList = titles.map((title) => {
      const rawCode = generateCode();
      return {
        rawCode,
        codeHash: hashSecret(rawCode),
        positionTitle: title,
        eventId: event.id
      };
    });

    // Write hashes to DB
    await prisma.winnerCode.createMany({
      data: codeList.map((c) => ({
        eventId: c.eventId,
        codeHash: c.codeHash,
        positionTitle: c.positionTitle
      }))
    });

    // Return the raw plaintext codes ONLY ONCE
    res.status(201).json({
      message: "Winner codes generated successfully. Store them safely; hashes are saved.",
      codes: codeList.map((c) => ({ title: c.positionTitle, code: c.rawCode }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// Fetch all events
export const getEvents = async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      orderBy: { eventDate: "asc" }
    });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Create a new event
export const createEvent = async (req, res) => {
  try {
    const { title, description, eventDate, registrationDeadline, location, coverImage } = req.body;

    const event = await prisma.event.create({
      data: {
        title,
        description,
        organizerId: req.user.id,
        eventDate: new Date(eventDate),
        registrationDeadline: new Date(registrationDeadline),
        location,
        coverImage: coverImage || "https://via.placeholder.com/600x400"
      }
    });

    res.status(201).json({ message: "Event created successfully", event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Register user for an event
export const registerForEvent = async (req, res) => {
  const { id: eventId } = req.params;
  const userId = req.user.id;

  try {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (new Date() > new Date(event.registrationDeadline)) {
      return res.status(400).json({ error: "Registration deadline has passed." });
    }

    const registration = await prisma.eventParticipant.create({
      data: { eventId, userId }
    });

    res.status(201).json({ message: "Registered successfully!", registration });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "You are already registered for this event." });
    }
    res.status(500).json({ error: err.message });
  }
};