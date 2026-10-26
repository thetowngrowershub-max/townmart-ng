/** Normalises a Nigerian mobile number to E.164 (+234…). Returns null if invalid. */
export function normaliseNigerianPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  let national: string;
  if (digits.startsWith("+234")) national = digits.slice(4);
  else if (digits.startsWith("234")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;
  return /^[789][01]\d{8}$/.test(national) ? `+234${national}` : null;
}

/** "+2348031234567" → "0803 ••• ••67", for showing which number a code went to. */
export function maskPhone(e164: string): string {
  const local = `0${e164.replace(/^\+234/, "")}`;
  return `${local.slice(0, 4)} ••• ••${local.slice(-2)}`;
}
