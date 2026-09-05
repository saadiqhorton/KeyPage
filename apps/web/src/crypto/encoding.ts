export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function base64Encode(data: Uint8Array): string {
  const binString = Array.from(data, (byte) => String.fromCodePoint(byte)).join(
    "",
  );
  return btoa(binString);
}

export function base64Decode(text: string): Uint8Array {
  const binString = atob(text);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.codePointAt(i) ?? 0;
  }
  return bytes;
}

export function base64urlEncode(data: Uint8Array): string {
  return base64Encode(data)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function base64urlDecode(text: string): Uint8Array {
  const padded =
    text.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (text.length % 4)) % 4);
  return base64Decode(padded);
}

export function hexEncode(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function hexDecode(text: string): Uint8Array {
  if (text.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
