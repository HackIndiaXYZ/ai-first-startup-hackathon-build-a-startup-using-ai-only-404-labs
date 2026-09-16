// Frame — Configuration
import * as fs from 'fs';
import * as path from 'path';

// Load .env manually for dev
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const rawEnv = (process.env.FRAME_ENVIRONMENT || process.env.FRAME_ENV || 'SANDBOX').toUpperCase();
const frameEnvironment: 'MOCK' | 'SANDBOX' | 'PRODUCTION' =
  rawEnv === 'MOCK' ? 'MOCK' : rawEnv === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frameEnv: frameEnvironment.toLowerCase() as 'mock' | 'sandbox' | 'production',
  frameEnvironment,
  paymentProvider: process.env.PAYMENT_PROVIDER || 'razorpay',
  databaseUrl: process.env.DATABASE_URL || 'postgres://frame:frame@localhost:5432/frame',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-prod-must-be-32-chars-min',
  apiKeySalt: process.env.API_KEY_SALT || 'dev-salt-change-in-prod',
  isDev: process.env.NODE_ENV !== 'production',
  isSandbox: frameEnvironment === 'SANDBOX',
  isProduction: frameEnvironment === 'PRODUCTION',
  isMock: frameEnvironment === 'MOCK',

  validateEnvironment(): void {
    if (frameEnvironment === 'PRODUCTION') {
      if (this.jwtSecret.includes('dev-jwt-secret')) {
        throw new Error('FATAL CONFIGURATION ERROR: Default JWT_SECRET cannot be used in PRODUCTION environment.');
      }
      if (this.apiKeySalt.includes('dev-salt')) {
        throw new Error('FATAL CONFIGURATION ERROR: Default API_KEY_SALT cannot be used in PRODUCTION environment.');
      }
      if (this.paymentProvider === 'razorpay') {
        const keyId = process.env.RAZORPAY_KEY_ID || '';
        if (!keyId.startsWith('rzp_live_')) {
          throw new Error('FATAL CONFIGURATION ERROR: Production Razorpay requires live key starting with "rzp_live_".');
        }
        if (!process.env.RAZORPAY_KEY_SECRET) {
          throw new Error('FATAL CONFIGURATION ERROR: Production Razorpay requires RAZORPAY_KEY_SECRET.');
        }
      }
    }
  }
};

export type Config = typeof config;
