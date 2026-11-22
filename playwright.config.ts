import fs from "node:fs";
import { defineConfig } from "@playwright/test";

const hasSystemChrome = fs.existsSync(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...(hasSystemChrome ? { channel: "chrome" } : {}),
    headless: true,
    acceptDownloads: true,
  },
  webServer: {
    command: "pnpm exec next start -p 3100 -H 127.0.0.1",
    url: "http://127.0.0.1:3100/offline",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      DB_PATH: "./tmp/pw-test.db",
      TEMP_DIR: "./tmp/pw-temp",
      APP_PASSWORD: "",
    },
  },
});
