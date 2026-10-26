export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/** Every email goes through this interface so providers can be swapped by env var. */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string | null }>;
}
