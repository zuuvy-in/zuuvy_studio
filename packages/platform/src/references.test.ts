import { describe, expect, it } from "vitest";
import { checkReferenceUrl, isPublicAddress, summariseHtml } from "./references";
import { sniffImage } from "./media";
import { toAttachments } from "./attachments";
import { normaliseHostname, isApex, nextCheckDelay } from "./domains";

describe("reference websites", () => {
  it("refuses anything that is not a public web address", () => {
    for (const bad of ["ftp://x.com", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://10.1.2.3", "https://user:pw@example.com", "http://example.com:8080", "http://service.internal/"]) {
      expect(() => checkReferenceUrl(bad), bad).toThrow();
    }
    expect(checkReferenceUrl("https://example.com/a?b=1").hostname).toBe("example.com");
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("192.168.1.1")).toBe(false);
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:7f00:1")).toBe(false);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });

  it("reduces a page to a designer's notes without running anything in it", () => {
    const html = `<html><head><title>Chai &amp; Co</title><meta name="description" content="Tea, properly.">
      <meta name="theme-color" content="#0f766e"><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400&family=Lora" rel="stylesheet">
      <style>.a{color:#FF6600}.b{background:#ff6600}.c{color:#222}</style><script>alert(1)</script></head>
      <body><nav><a href="/">Home</a><a href="/menu">Menu</a></nav><main><section><h1>Fresh chai</h1><p>Brewed daily.</p></section>
      <section><h2>Visit us</h2></section></main></body></html>`;
    const s = summariseHtml("https://chai.test", html);
    expect(s.title).toBe("Chai & Co");
    expect(s.description).toBe("Tea, properly.");
    expect(s.navigation).toEqual(["Home", "Menu"]);
    expect(s.headings).toEqual(["# Fresh chai", "## Visit us"]);
    expect(s.sections).toEqual(["Fresh chai", "Visit us"]);
    expect(s.colors.slice(0, 2)).toEqual(["#0f766e", "#ff6600"]);
    expect(s.fonts).toEqual(["DM Sans", "Lora"]);
    expect(s.text).not.toContain("alert");
  });
});

describe("uploads and attachments", () => {
  it("trusts bytes, not names", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))?.type).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(() => toAttachments([{ name: "brief.pdf", bytes: new TextEncoder().encode("not a pdf") }])).toThrow(/does not look like/);
    expect(() => toAttachments([{ name: "run.exe", bytes: new Uint8Array([1]) }])).toThrow(/attach PDF/);
    const ok = toAttachments([
      { name: "brief.pdf", bytes: new TextEncoder().encode("%PDF-1.7 ...") },
      { name: "prices.csv", bytes: new TextEncoder().encode("name,price\nMug,250") },
      { name: "empty.txt", bytes: new Uint8Array() },
    ]);
    expect(ok.map((x) => x.format)).toEqual(["pdf", "csv"]);
  });
});

describe("custom domain names", () => {
  it("normalises what people type and refuses what cannot be a domain", () => {
    expect(normaliseHostname("  https://WWW.Shop.IN/about?x ")).toBe("www.shop.in");
    expect(normaliseHostname("दुकान.भारत")).toMatch(/^xn--/);
    for (const bad of ["", "localhost", "*.shop.in", "1.2.3.4", "shop", "-bad.in"]) expect(() => normaliseHostname(bad), bad).toThrow();
    expect(isApex("shop.in")).toBe(true);
    expect(isApex("shop.co.in")).toBe(true);
    expect(isApex("www.shop.in")).toBe(false);
    expect(nextCheckDelay(60)).toBe(60);
    expect(nextCheckDelay(3600)).toBe(300);
    expect(nextCheckDelay(10 * 3600)).toBe(1800);
  });
});
