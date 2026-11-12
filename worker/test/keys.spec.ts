import { describe, expect, it } from "vitest";
import { ADMIN_PORTAL, SLAVE_PORTAL, toPublicObjectKey } from "../src/keys";

describe("toPublicObjectKey", () => {
  it("prefixes a bare scrap name with the slave portal", () => {
    expect(toPublicObjectKey("scraps/photo.jpg")).toBe(`${SLAVE_PORTAL}/scraps/photo.jpg`);
  });

  it("rewrites a leading admin portal segment", () => {
    expect(toPublicObjectKey(`${ADMIN_PORTAL}/scraps/photo.jpg`)).toBe(
      `${SLAVE_PORTAL}/scraps/photo.jpg`,
    );
  });

  it("keeps a key that already uses the slave portal", () => {
    expect(toPublicObjectKey(`${SLAVE_PORTAL}/scraps/photo.jpg`)).toBe(
      `${SLAVE_PORTAL}/scraps/photo.jpg`,
    );
  });

  it("decodes a single layer of percent-encoding", () => {
    expect(toPublicObjectKey("scraps/%70hoto.jpg")).toBe(`${SLAVE_PORTAL}/scraps/photo.jpg`);
  });

  it.each([
    ["..", "scraps/../../secret"],
    ["encoded dot segments", "scraps/%2e%2e/secret"],
    ["a scheme", "https://example.com/a.jpg"],
    ["an admin segment deeper in the path", `${SLAVE_PORTAL}/${ADMIN_PORTAL}/a.jpg`],
    ["the portal id alone", ADMIN_PORTAL],
    ["junction shorts prefix", "shorts/clip.mp4"],
    ["shorts under the slave portal", `${SLAVE_PORTAL}/shorts/clip.mp4`],
    ["an empty string", "   "],
    ["a non-string", 1001],
  ])("rejects %s", (_label, input) => {
    expect(() => toPublicObjectKey(input)).toThrow(/invalid key|key must be a string/);
  });
});
