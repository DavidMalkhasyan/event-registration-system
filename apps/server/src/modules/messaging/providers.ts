import type { Config } from '../../platform/config.js';
import { FakeEmailProvider, type EmailProvider } from './fake-provider.js';
import { ResendEmailProvider } from './resend-provider.js';

/** K-717: the provider the configuration names (the configuration check guarantees what it needs). */
export function emailProviderFor(config: Config): EmailProvider {
  if (config.EMAIL_PROVIDER === 'resend')
    return new ResendEmailProvider({
      apiKey: config.RESEND_API_KEY!,
      from: config.EMAIL_FROM!,
      apiUrl: config.RESEND_API_URL,
      ...(config.EMAIL_REPLY_TO ? { replyTo: config.EMAIL_REPLY_TO } : {}),
    });
  return new FakeEmailProvider(config.DEV_MAILBOX_DIR);
}
