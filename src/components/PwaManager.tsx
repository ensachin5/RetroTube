"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const INSTALL_DISMISS_KEY = "retrotube-install-dismissed-at";
const IOS_HINT_DISMISS_KEY = "retrotube-ios-hint-dismissed";
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function isRunningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIosDevice = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIosDevice && isSafari;
}

function isDismissedWithin14Days(): boolean {
  try {
    const raw = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < FOURTEEN_DAYS_MS;
  } catch {
    return false;
  }
}

export function PwaManager() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [showIosHint, setShowIosHint] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const refreshingRef = useRef(false);
  const userRequestedUpdateRef = useRef(false);

  // Register Service Worker in production only + listen for updates
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      typeof window === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    let cancelled = false;
    const hadController = Boolean(navigator.serviceWorker.controller);

    const onControllerChange = () => {
      if (!hadController || !userRequestedUpdateRef.current || refreshingRef.current) {
        return;
      }
      refreshingRef.current = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        if (cancelled) return;

        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(installing);
            }
          });
        });
      })
      .catch(() => {
        // Ignore SW registration failures on restricted origins
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  // Capture Android/Chromium beforeinstallprompt or detect iOS Safari
  useEffect(() => {
    if (typeof window === "undefined" || isRunningStandalone()) {
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (isDismissedWithin14Days()) return;
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setShowIosHint(false);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setShowIosHint(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isIosSafari()) {
      let alreadyDismissed = false;
      try {
        alreadyDismissed = localStorage.getItem(IOS_HINT_DISMISS_KEY) === "1";
      } catch {
        alreadyDismissed = false;
      }
      if (!alreadyDismissed) {
        timer = setTimeout(() => {
          setShowIosHint(true);
        }, 0);
      }
    }

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "dismissed") {
      try {
        localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
      } catch {
        // Ignore storage errors
      }
    }
    setDeferredPrompt(null);
  };

  const handleDismissInstall = () => {
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    } catch {
      // Ignore storage errors
    }
    setDeferredPrompt(null);
  };

  const handleDismissIosHint = () => {
    try {
      localStorage.setItem(IOS_HINT_DISMISS_KEY, "1");
    } catch {
      // Ignore storage errors
    }
    setShowIosHint(false);
  };

  const handleReloadForUpdate = () => {
    if (!waitingWorker) return;
    userRequestedUpdateRef.current = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <>
      {waitingWorker ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-3 right-3 bottom-20 md:left-auto md:right-5 md:bottom-5 z-50 md:max-w-sm"
        >
          <Card tone="success" className="p-3.5 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--text-ink)]">
              Update available for RetroTube.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="secondary" size="sm" onClick={handleReloadForUpdate}>
                Reload
              </Button>
              <Button variant="surface" size="sm" onClick={() => setWaitingWorker(null)}>
                Later
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {deferredPrompt ? (
        <div className="mx-auto w-full max-w-5xl px-3 pt-3 sm:px-6">
          <Card
            tone="alt"
            className="p-3 flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-xs sm:text-sm font-semibold text-[var(--text-ink)]">
              Install RetroTube on your device for instant app-mode launching and Android
              link sharing.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="accent"
                size="sm"
                onClick={() => void handleInstallClick()}
              >
                Install RetroTube
              </Button>
              <Button variant="surface" size="sm" onClick={handleDismissInstall}>
                Dismiss
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {showIosHint ? (
        <div className="mx-auto w-full max-w-5xl px-3 pt-3 sm:px-6">
          <Card
            tone="alt"
            className="p-3 flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-xs sm:text-sm font-semibold text-[var(--text-ink)]">
              Add to iOS Home Screen: tap <strong>Share</strong> in Safari, then{" "}
              <strong>Add to Home Screen</strong>.
            </p>
            <Button variant="surface" size="sm" onClick={handleDismissIosHint}>
              Got it
            </Button>
          </Card>
        </div>
      ) : null}
    </>
  );
}
