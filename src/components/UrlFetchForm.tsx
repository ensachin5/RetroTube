"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/src/components/ui/Button";
import { Input } from "@/src/components/ui/Input";
import { validateYouTubeUrlClient } from "@/src/lib/client-url";

export interface UrlFetchFormProps {
  initialUrl?: string;
  loading: boolean;
  onFetch: (url: string) => void;
  onClipboardFallback?: (message: string) => void;
}

export function UrlFetchForm({
  initialUrl = "",
  loading,
  onFetch,
  onClipboardFallback,
}: UrlFetchFormProps) {
  const [url, setUrl] = useState(initialUrl);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submitUrl = (candidate: string) => {
    const check = validateYouTubeUrlClient(candidate);
    if (!check.ok) {
      setValidationError(check.message);
      inputRef.current?.focus();
      return;
    }
    setValidationError(null);
    onFetch(candidate.trim());
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitUrl(url);
  };

  const handlePaste = async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard ||
      typeof navigator.clipboard.readText !== "function"
    ) {
      inputRef.current?.focus();
      onClipboardFallback?.(
        "Clipboard access unavailable — paste your link directly into the box.",
      );
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        inputRef.current?.focus();
        onClipboardFallback?.("Clipboard is empty. Copy a YouTube link first.");
        return;
      }
      setUrl(text.trim());
      setValidationError(null);
      inputRef.current?.focus();
    } catch {
      inputRef.current?.focus();
      onClipboardFallback?.(
        "Clipboard permission denied — press Ctrl+V / Cmd+V in the URL field.",
      );
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <label
        htmlFor="youtube-url-input"
        className="block font-display text-xs sm:text-sm font-bold uppercase tracking-wider text-[var(--text-ink)]"
      >
        YouTube Video or Playlist URL
      </label>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            id="youtube-url-input"
            name="url"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="url"
            value={url}
            hasError={validationError !== null}
            aria-invalid={validationError !== null}
            aria-describedby={validationError ? "url-validation-error" : "url-input-hint"}
            placeholder="https://www.youtube.com/watch?v=... or playlist?list=..."
            onChange={(e) => {
              setUrl(e.target.value);
              if (validationError) setValidationError(null);
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").trim();
              if (pasted) {
                const check = validateYouTubeUrlClient(pasted);
                if (check.ok) {
                  setValidationError(null);
                }
              }
            }}
            className={url ? "pr-12" : ""}
          />
          {url.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setUrl("");
                setValidationError(null);
                inputRef.current?.focus();
              }}
              aria-label="Clear URL input"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-ink)] cursor-pointer"
            >
              ×
            </button>
          ) : null}
        </div>

        <div className="flex gap-2.5">
          <Button
            type="button"
            variant="surface"
            size="lg"
            onClick={() => void handlePaste()}
            disabled={loading}
            className="flex-1 sm:flex-none"
          >
            Paste
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={loading}
            className="flex-1 sm:flex-none sm:min-w-28"
          >
            {loading ? "Fetching..." : "Fetch"}
          </Button>
        </div>
      </div>

      {validationError ? (
        <p
          id="url-validation-error"
          role="alert"
          aria-live="assertive"
          className="rounded-md border-2 border-[var(--border-error)] bg-[var(--bg-error)] px-3 py-2 text-sm font-semibold text-[var(--text-ink)]"
        >
          {validationError}
        </p>
      ) : (
        <p id="url-input-hint" className="text-xs sm:text-sm text-[var(--text-muted)]">
          Supports single videos, playlists, Shorts, and music.youtube.com.
        </p>
      )}
    </form>
  );
}
