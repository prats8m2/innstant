import { describe, it, expect, afterEach } from 'vitest';
import { ConsoleOtpSender, DemoOtpSender, otpSender, assertSenderIsSafeFor } from './otp-sender';

/**
 * The guard is the only thing standing between a demo convenience and every
 * customer's one-time code in a log, so it gets tested rather than trusted.
 */
describe('which sender runs, and where', () => {
  afterEach(() => { delete process.env.OTP_DEMO_CODE; });

  it('ships the console sender when nothing is configured', () => {
    expect(otpSender()).toBeInstanceOf(ConsoleOtpSender);
  });

  it('switches to the demo sender the moment a fixed code is set', () => {
    process.env.OTP_DEMO_CODE = '0000';
    expect(otpSender()).toBeInstanceOf(DemoOtpSender);
  });

  it('treats whitespace as unset, so a blank variable is not a silent bypass', () => {
    process.env.OTP_DEMO_CODE = '   ';
    expect(otpSender()).toBeInstanceOf(ConsoleOtpSender);
  });

  it('refuses the console sender in production — a random code in a log is a credential', () => {
    expect(() => assertSenderIsSafeFor(new ConsoleOtpSender(), 'production')).toThrow(/console sender/);
  });

  it('allows the console sender outside production', () => {
    expect(() => assertSenderIsSafeFor(new ConsoleOtpSender(), 'development')).not.toThrow();
  });

  it('allows the demo sender in production, deliberately', () => {
    expect(() => assertSenderIsSafeFor(new DemoOtpSender(), 'production')).not.toThrow();
  });

  it('never writes the code down', async () => {
    const seen: unknown[] = [];
    const spy = { warn: (...a: unknown[]) => seen.push(a), info: () => {}, error: () => {} };
    const { logger } = await import('@/lib/logger');
    const original = logger.warn.bind(logger);
    (logger as unknown as { warn: unknown }).warn = spy.warn;
    try {
      await new DemoOtpSender().send({ phone: '+919829011111', code: '0000', expiresInMinutes: 10 });
    } finally {
      (logger as unknown as { warn: unknown }).warn = original;
    }
    expect(JSON.stringify(seen)).not.toContain('0000');
    expect(JSON.stringify(seen)).toContain('FIXED DEMO OTP IS ACTIVE');
  });
});
