const HEX = "0123456789abcdef";

function randomHex(length: number): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(Math.ceil(length / 2));
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i] ?? 0;
      out += HEX[(b >> 4) & 0xf];
      out += HEX[b & 0xf];
    }
    return out.slice(0, length);
  }
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

export function newId(prefix?: string): string {
  const ts = Date.now().toString(36).padStart(9, "0");
  const rand = randomHex(12);
  const id = `${ts}${rand}`;
  return prefix ? `${prefix}_${id}` : id;
}

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
