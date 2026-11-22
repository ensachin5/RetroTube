// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UrlFetchForm } from "@/src/components/UrlFetchForm";

describe("UrlFetchForm (RTL)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("rejects invalid hostnames client-side without calling onFetch", async () => {
    const user = userEvent.setup();
    const onFetch = vi.fn();

    render(<UrlFetchForm loading={false} onFetch={onFetch} />);

    const input = screen.getByLabelText(/YouTube.*URL/i);
    await user.type(input, "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ");
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(onFetch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/unsupported domain/i);
  });

  it("accepts valid playlist URLs client-side and triggers onFetch", async () => {
    const user = userEvent.setup();
    const onFetch = vi.fn();

    render(<UrlFetchForm loading={false} onFetch={onFetch} />);

    const input = screen.getByLabelText(/YouTube.*URL/i);
    await user.type(input, "https://www.youtube.com/playlist?list=PL123456");
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(onFetch).toHaveBeenCalledWith(
      "https://www.youtube.com/playlist?list=PL123456",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads clipboard on Paste click and falls back gracefully when denied", async () => {
    const user = userEvent.setup();
    const onFetch = vi.fn();
    const onFallback = vi.fn();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi
          .fn()
          .mockResolvedValueOnce("https://youtu.be/dQw4w9WgXcQ")
          .mockRejectedValueOnce(new Error("Denied")),
      },
    });

    render(
      <UrlFetchForm loading={false} onFetch={onFetch} onClipboardFallback={onFallback} />,
    );

    await user.click(screen.getByRole("button", { name: "Paste" }));
    expect(screen.getByLabelText(/YouTube.*URL/i)).toHaveValue(
      "https://youtu.be/dQw4w9WgXcQ",
    );

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(onFetch).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ");

    await user.click(screen.getByRole("button", { name: "Paste" }));
    expect(onFallback).toHaveBeenCalledWith(
      expect.stringMatching(/clipboard permission denied/i),
    );
  });
});
