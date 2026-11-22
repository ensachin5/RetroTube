"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Input } from "@/src/components/ui/Input";

export interface UnlockFormProps {
  nextPath: string;
}

export function UnlockForm({ nextPath }: UnlockFormProps) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password) {
      setError("Enter the access password.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Incorrect password.");
        return;
      }

      const safeTarget =
        nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
      window.location.assign(safeTarget);
    } catch {
      setError("Network error while verifying password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="mx-auto max-w-md p-5 sm:p-6 space-y-4">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-black">Deck Locked</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Enter the configured APP_PASSWORD to access RetroTube.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="app-password"
            className="block font-display text-xs font-bold uppercase tracking-wider"
          >
            Password
          </label>
          <Input
            id="app-password"
            type="password"
            autoComplete="current-password"
            value={password}
            hasError={error !== null}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Enter password..."
          />
        </div>

        {error ? (
          <p
            role="alert"
            aria-live="assertive"
            className="rounded border-2 border-[var(--border-error)] bg-[var(--bg-error)] px-3 py-2 text-sm font-semibold"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={submitting}
          className="w-full"
        >
          {submitting ? "Unlocking..." : "Unlock Deck"}
        </Button>
      </form>
    </Card>
  );
}
