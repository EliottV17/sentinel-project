import { beforeEach, describe, expect, it } from "vitest";
import { tokenStore } from "./token";

describe("tokenStore", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("starts empty", () => {
    expect(tokenStore.get()).toBeNull();
  });

  it("set/get/clear keeps in-memory token and writes through to sessionStorage", () => {
    tokenStore.set("abc.def.ghi");
    expect(tokenStore.get()).toBe("abc.def.ghi");
    expect(sessionStorage.getItem("sentinel.access_token")).toBe("abc.def.ghi");

    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
    expect(sessionStorage.getItem("sentinel.access_token")).toBeNull();
  });

  it("restores from sessionStorage on first read after a simulated refresh", async () => {
    // Simulate a browser refresh: a fresh module instance has no in-memory
    // token, but sessionStorage survives. The store must lazily restore on
    // first read.
    sessionStorage.setItem("sentinel.access_token", "restored.token");
    vi.resetModules();
    const { tokenStore: freshStore } = await import("./token");
    expect(freshStore.get()).toBe("restored.token");
  });

  it("never touches localStorage", () => {
    // localStorage is not usable in the test runtime (Node webstorage shim);
    // arm it as an access bomb so any use by the store fails this test.
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("tokenStore must never use localStorage");
      },
    });
    try {
      tokenStore.set("t");
      tokenStore.get();
      tokenStore.clear();
    } finally {
      if (original) {
        Object.defineProperty(globalThis, "localStorage", original);
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      }
    }
  });
});
