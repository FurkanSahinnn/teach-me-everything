import { describe, expect, it } from "vitest";
import { isLocalUrl } from "../local-bypass";

describe("isLocalUrl — positive cases", () => {
  it("treats localhost as local", () => {
    expect(isLocalUrl("http://localhost")).toBe(true);
    expect(isLocalUrl("http://localhost:11434")).toBe(true);
    expect(isLocalUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalUrl("https://localhost:8443")).toBe(true);
  });

  it("treats 127.0.0.1 and other 127/8 loopbacks as local", () => {
    expect(isLocalUrl("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalUrl("http://127.0.0.5")).toBe(true);
  });

  it("treats 0.0.0.0 and IPv6 loopback as local", () => {
    expect(isLocalUrl("http://0.0.0.0:8080")).toBe(true);
    expect(isLocalUrl("http://[::1]:8080")).toBe(true);
  });

  it("treats RFC1918 192.168/16 addresses as local", () => {
    expect(isLocalUrl("http://192.168.1.5:11434")).toBe(true);
    expect(isLocalUrl("https://192.168.0.10/v1")).toBe(true);
  });

  it("treats RFC1918 10/8 addresses as local", () => {
    expect(isLocalUrl("http://10.0.0.5")).toBe(true);
    expect(isLocalUrl("http://10.20.30.40:8080/v1")).toBe(true);
  });

  it("treats RFC1918 172.16/12 addresses as local", () => {
    expect(isLocalUrl("http://172.16.0.1")).toBe(true);
    expect(isLocalUrl("http://172.20.30.40:8080")).toBe(true);
    expect(isLocalUrl("http://172.31.255.254")).toBe(true);
  });

  it("treats *.local mDNS hostnames as local", () => {
    expect(isLocalUrl("http://myhost.local")).toBe(true);
    expect(isLocalUrl("http://mac-studio.local:11434")).toBe(true);
    expect(isLocalUrl("http://foo.bar.local/v1")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isLocalUrl("HTTP://LOCALHOST:11434")).toBe(true);
    expect(isLocalUrl("http://MyHost.Local")).toBe(true);
  });
});

describe("isLocalUrl — negative cases", () => {
  it("rejects public cloud endpoints", () => {
    expect(isLocalUrl("https://api.openai.com/v1")).toBe(false);
    expect(isLocalUrl("https://api.anthropic.com")).toBe(false);
    expect(isLocalUrl("https://generativelanguage.googleapis.com/v1beta")).toBe(false);
    expect(isLocalUrl("https://example.com")).toBe(false);
  });

  it("rejects public IPv4 addresses including 8.8.8.8", () => {
    expect(isLocalUrl("http://8.8.8.8")).toBe(false);
    expect(isLocalUrl("http://1.1.1.1")).toBe(false);
  });

  it("rejects 172 addresses outside the 16-31 RFC1918 window", () => {
    expect(isLocalUrl("http://172.15.0.1")).toBe(false);
    expect(isLocalUrl("http://172.32.0.1")).toBe(false);
    expect(isLocalUrl("http://172.100.0.1")).toBe(false);
  });

  it("rejects domains that merely contain 'local' but do not end with .local", () => {
    expect(isLocalUrl("http://localhost.example.com")).toBe(false);
    expect(isLocalUrl("http://local.example.com")).toBe(false);
  });
});

describe("isLocalUrl — invalid inputs", () => {
  it("rejects empty / non-string / malformed URLs", () => {
    expect(isLocalUrl("")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
    expect(isLocalUrl("://broken")).toBe(false);
    // Intentional cast: runtime callers may pass anything from settings JSON.
    expect(isLocalUrl(undefined as unknown as string)).toBe(false);
    expect(isLocalUrl(null as unknown as string)).toBe(false);
  });

  it("rejects non-http(s) protocols", () => {
    expect(isLocalUrl("ftp://localhost")).toBe(false);
    expect(isLocalUrl("file:///etc/passwd")).toBe(false);
    expect(isLocalUrl("ws://localhost:11434")).toBe(false);
  });
});
