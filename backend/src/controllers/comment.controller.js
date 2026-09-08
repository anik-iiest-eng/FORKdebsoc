// In comment.controller.js -> getCommentsByEvent
export const getEventComments = async (req, res) => {
  const { eventId } = req.params;

  const comments = await prisma.comment.findMany({
    where: { eventId },
    include: {
      user: {
        select: { id: true, displayName: true, profileImage: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Strip author data if isAnonymous is true
  const sanitized = comments.map(c => {
    if (c.isAnonymous) {
      return {
        ...c,
        user: { id: null, displayName: "Anonymous Debater", profileImage: null }
      };
    }
    return c;
  });

  res.json(sanitized);
};