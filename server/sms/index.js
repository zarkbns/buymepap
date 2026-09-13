import config from '../config.js';
import { db } from '../db.js';

/**
 * OTP delivery boundary. The mock adapter records messages in sms_outbox so
 * local development and the test suite can complete the flow without an SMS
 * provider; it is unreachable in production (config refuses SMS_PROVIDER=mock
 * outside non-production, and this module still guards on its own).
 */
async function sendOtpSms(phone, code) {
  const message = `BuyMePap: your verification code is ${code}. It expires in ${Math.round(config.otpTtlSeconds / 60)} minutes.`;
  if (config.smsProvider === 'mock') {
    if (config.isProd) throw new Error('Mock SMS delivery is not allowed in production.');
    db.prepare('INSERT INTO sms_outbox (phone_e164, body) VALUES (?, ?)').run(phone, message);
    return { delivered: true, mock: true };
  }
  const res = await fetch(config.sms.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.sms.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: phone, from: config.sms.senderId, message }),
    signal: AbortSignal.timeout(config.sms.timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`SMS delivery failed (HTTP ${res.status})`);
  }
  return { delivered: true };
}

export { sendOtpSms };
