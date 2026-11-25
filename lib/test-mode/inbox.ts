/**
 * True while a test-mode site keeps emails or texts in the test inbox. Once
 * both really send, the inbox closes: it is public to everyone on the test
 * site, so it must not keep showing old sign-up links and codes. Reads
 * process.env directly (with test mode's defaults) so the layout can call it
 * even while other settings are incomplete.
 */
export function testInboxOpen(): boolean {
  if (process.env.TOWNMART_TEST_MODE !== "true") return false;
  return (process.env.EMAIL_PROVIDER ?? "outbox") === "outbox" || (process.env.SMS_PROVIDER ?? "outbox") === "outbox";
}
