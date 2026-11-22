// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JobProgressPanel,
  type ActiveDownloadJob,
} from "@/src/components/JobProgressPanel";

type ListenerMap = Map<string, Array<(event: MessageEvent<string>) => void>>;

class MockEventSource {
  public static instances: MockEventSource[] = [];
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSED = 2;

  public readyState = MockEventSource.OPEN;
  public onmessage: ((event: MessageEvent<string>) => void) | null = null;
  public onerror: (() => void) | null = null;
  public closed = false;
  private listeners: ListenerMap = new Map();

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (event: MessageEvent<string>) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  emit(type: string, data: unknown): void {
    const evt = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const cb of this.listeners.get(type) ?? []) {
      cb(evt);
    }
  }

  triggerError(nextReadyState = MockEventSource.CLOSED): void {
    this.readyState = nextReadyState;
    this.onerror?.();
  }

  close(): void {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }
}

const SAMPLE_JOB: ActiveDownloadJob = {
  jobId: "00000000-0000-4000-8000-000000000123",
  outputFilename: "RetroTube Video [1080p].mp4",
  eventsUrl: "/api/jobs/00000000-0000-4000-8000-000000000123/events",
  streamUrl: "/api/download/00000000-0000-4000-8000-000000000123/stream",
  needsMerge: true,
};

describe("JobProgressPanel (RTL)", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "cancelled" }))),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders SSE progress, handles reconnect warning, and renders Save File link on done", async () => {
    const onDismiss = vi.fn();
    render(<JobProgressPanel job={SAMPLE_JOB} onDismiss={onDismiss} />);

    const es = MockEventSource.instances[0]!;
    expect(es.url).toBe(SAMPLE_JOB.eventsUrl);

    act(() => {
      es.emit("progress", {
        jobId: SAMPLE_JOB.jobId,
        status: "running",
        progressPct: 48,
        stage: "downloading_video",
        speed: "3.2MiB/s",
        etaSec: 12,
      });
    });

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "48");
    expect(screen.getByText(/Pulling Video Track/i)).toBeInTheDocument();
    expect(screen.getByText("3.2MiB/s")).toBeInTheDocument();
    expect(screen.getByText("ETA 12s")).toBeInTheDocument();

    // Simulate transient disconnect -> shows reconnect banner
    act(() => {
      es.triggerError(MockEventSource.CLOSED);
    });
    expect(screen.getByText(/connection interrupted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();

    // Simulate done event
    act(() => {
      es.emit("done", {
        jobId: SAMPLE_JOB.jobId,
        status: "done",
        progressPct: 100,
        stage: "done",
        streamUrl: SAMPLE_JOB.streamUrl,
        outputFilename: SAMPLE_JOB.outputFilename,
        bytesTotal: 10485760,
      });
    });

    const saveLink = screen.getByRole("link", { name: "Save File" });
    expect(saveLink).toHaveAttribute("href", SAMPLE_JOB.streamUrl);
    expect(saveLink).toHaveAttribute("download", SAMPLE_JOB.outputFilename);
  });

  it("calls cancel endpoint and renders failed errors accessibly", async () => {
    const user = userEvent.setup();
    render(<JobProgressPanel job={SAMPLE_JOB} onDismiss={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/jobs/${SAMPLE_JOB.jobId}/cancel`,
      { method: "POST" },
    );

    const es = MockEventSource.instances[0]!;
    act(() => {
      es.emit("failed", {
        jobId: SAMPLE_JOB.jobId,
        status: "failed",
        progressPct: 15,
        stage: "failed",
        errorCode: "FFMPEG_FAILED",
        errorMessage: "ffmpeg failed while merging streams.",
      });
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/Mux \/ Encode Error/i);
  });
});
