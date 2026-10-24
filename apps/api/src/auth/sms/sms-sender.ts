import { Logger } from '@nestjs/common';
import { maskPhone } from '@driva/shared';
import { AppConfig } from '../../config/config';

export const SMS_SENDER = Symbol('SMS_SENDER');

/** Sends SMS. Behind an interface so Termii can be swapped for Africa's Talking. */
export interface SmsSender {
  /** `phone` is E.164, for example +2348035550142. */
  send(phone: string, message: string): Promise<void>;
}

/** Development only: prints the message instead of sending it. Refused in production by config. */
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('ConsoleSms');

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`SMS to ${maskPhone(phone)}: ${message}`);
  }
}

export class TermiiSmsSender implements SmsSender {
  private readonly logger = new Logger('TermiiSms');

  constructor(private readonly config: { apiKey: string; senderId: string; baseUrl: string }) {}

  async send(phone: string, message: string): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.config.apiKey,
        to: phone.replace(/^\+/, ''),
        from: this.config.senderId,
        sms: message,
        type: 'plain',
        // The DND route still delivers to numbers that opted out of promotional SMS.
        channel: 'dnd',
      }),
    });
    if (!res.ok) {
      this.logger.error(`Termii refused an SMS to ${maskPhone(phone)} with status ${res.status}`);
      throw new Error('SMS could not be sent');
    }
  }
}

export function createSmsSender(config: AppConfig): SmsSender {
  return config.sms.provider === 'termii'
    ? new TermiiSmsSender(config.sms)
    : new ConsoleSmsSender();
}
