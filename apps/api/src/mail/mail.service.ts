import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Outbound email. Only development transports exist today:
 *   log     - writes the message to the API log so links can be opened locally.
 *   capture - keeps messages in memory (integration tests).
 * loadConfig() refuses NODE_ENV=production until a real provider transport is
 * implemented, so these can never silently run in production.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  readonly captured: MailMessage[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async send(message: MailMessage): Promise<void> {
    if (this.config.mailTransport === 'capture') {
      this.captured.push(message);
      return;
    }
    this.logger.log(`[dev mail] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }

  link(path: string, token: string): string {
    const url = new URL(path, this.config.appPublicUrl);
    // Token in the fragment: not sent to servers in Referer headers or access logs.
    url.hash = `token=${token}`;
    return url.toString();
  }
}
