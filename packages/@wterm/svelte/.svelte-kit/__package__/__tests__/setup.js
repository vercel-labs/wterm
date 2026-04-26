import { vi } from "vitest";
Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
    })),
});
