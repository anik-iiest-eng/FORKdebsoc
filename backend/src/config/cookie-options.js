export const crossSiteCookieOptions = (req) => {
  const secure = req.secure || req.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
  return {
    secure,
    sameSite: secure ? 'none' : 'lax',
    partitioned: secure
  };
};
