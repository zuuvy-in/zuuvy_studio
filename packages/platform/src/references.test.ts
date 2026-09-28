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

describe("picture models", async () => {
  const { renderImage, imageApi, imageSize } = await import("./media");

  it("uses Converse for Nova 2 Omni and reads the picture and its size from the reply", async () => {
    // A 3×2 PNG header is enough for the size reader.
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2]);
    const sent: unknown[] = [];
    const client = {
      async send(cmd: { input: unknown; constructor: { name: string } }) {
        sent.push(cmd);
        return { stopReason: "end_turn", output: { message: { role: "assistant", content: [{ image: { format: "png", source: { bytes: png } } }] } } };
      },
    };
    const out = await renderImage({ prompt: "A tidy shop counter", aspect: "wide", style: "flat" }, { client: client as never, model: { model: "global.amazon.nova-2-omni-v1:0", region: "ap-south-1" } });
    expect(imageApi("global.amazon.nova-2-omni-v1:0")).toBe("converse");
    expect(imageApi("amazon.nova-canvas-v1:0")).toBe("invoke");
    expect(out).toMatchObject({ width: 3, height: 2, contentType: "image/png", ext: "png" });
    expect((sent[0] as { constructor: { name: string } }).constructor.name).toBe("ConverseCommand");
    expect(JSON.stringify((sent[0] as { input: unknown }).input)).toMatch(/16:9/);
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("explains a legacy model in words", async () => {
    const client = { async send() { throw Object.assign(new Error("Access denied. This Model is marked by provider as Legacy"), { name: "ResourceNotFoundException" }); } };
    const lister = { async send() { return {}; } };
    await expect(renderImage({ prompt: "x picture of a shop", aspect: "square", style: "photo" }, { client: client as never, lister: lister as never, model: { model: "amazon.nova-canvas-v1:0", region: "us-east-1" } })).rejects.toThrow(/Legacy/);
  });
});

describe("finding an image model the account can call", async () => {
  const { renderImage } = await import("./media");
  it("replaces an id Bedrock calls invalid with the profile Bedrock lists, once", async () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8]);
    const tried: string[] = [];
    const client = {
      async send(cmd: { input: { modelId: string } }) {
        tried.push(cmd.input.modelId);
        if (cmd.input.modelId === "global.amazon.nova-2-omni-v1:0") {
          throw Object.assign(new Error("The provided model identifier is invalid."), { name: "ValidationException" });
        }
        return { output: { message: { role: "assistant", content: [{ image: { format: "png", source: { bytes: png } } }] } } };
      },
    };
    const lister = {
      async send(cmd: { constructor: { name: string } }) {
        if (cmd.constructor.name === "ListInferenceProfilesCommand") {
          return { inferenceProfileSummaries: [{ inferenceProfileId: "apac.amazon.nova-2-omni-v1:0", status: "ACTIVE" }, { inferenceProfileId: "apac.amazon.nova-pro-v1:0" }] };
        }
        return { modelSummaries: [] };
      },
    };
    const out = await renderImage(
      { prompt: "A tidy shop counter", aspect: "square", style: "photo" },
      { client: client as never, lister: lister as never, model: { model: "global.amazon.nova-2-omni-v1:0", region: "ap-south-1" } },
    );
    expect(tried).toEqual(["global.amazon.nova-2-omni-v1:0", "apac.amazon.nova-2-omni-v1:0"]);
    expect(out.width).toBe(8);
  });

  it("says plainly when Bedrock lists nothing usable", async () => {
    const client = { async send() { throw Object.assign(new Error("The provided model identifier is invalid."), { name: "ValidationException" }); } };
    const lister = { async send() { return { inferenceProfileSummaries: [], modelSummaries: [{ modelId: "amazon.nova-canvas-v1:0", modelLifecycle: { status: "LEGACY" } }] }; } };
    await expect(
      renderImage({ prompt: "A tidy shop counter", aspect: "square", style: "photo" }, { client: client as never, lister: lister as never, model: { model: "x.bad:0", region: "ap-south-1" } }),
    ).rejects.toThrow(/No image model this account can use from ap-south-1/);
  });
});
