const IPV4_LOOPBACK = [127, 0, 0, 1].join(".");

export function isLoopbackAddress(address: string): boolean {
  return (
    address === IPV4_LOOPBACK ||
    address === "::1" ||
    address === `::ffff:${IPV4_LOOPBACK}`
  );
}
