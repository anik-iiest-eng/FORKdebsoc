// src/utils/codeGenerator.js
import crypto from 'crypto';

export const generateSecureCode = () => {
  // Format: DEB-XXXX-XXXX
  const rawBytes = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `DEB-${rawBytes.slice(0, 4)}-${rawBytes.slice(4, 8)}`;
};

export const hashSecret = (code) => {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
};