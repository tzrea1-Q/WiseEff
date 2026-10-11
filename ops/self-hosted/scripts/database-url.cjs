const { readFileSync } = require("node:fs");

function databaseUrlError(databaseUrl, postgresPassword) {
  const message = "DATABASE_URL must be a valid PostgreSQL URL with expanded credentials: wiseeff requires the exact POSTGRES_PASSWORD; wiseeff_api requires a nonempty password.";
  try {
    const value = databaseUrl.trim();
    if (/\s/.test(value) || decodeURIComponent(value).includes("${")) {
      return message;
    }
    const url = new URL(value);
    if (url.searchParams.has("user") || url.searchParams.has("password")) {
      return message;
    }
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
      return message;
    }
    if (username === "wiseeff" && postgresPassword && password === postgresPassword) {
      return undefined;
    }
    if (username === "wiseeff_api" && password.trim()) {
      return undefined;
    }
  } catch {
    return message;
  }
  return message;
}

function checkDatabaseUrlFromStdin() {
  const [databaseUrl, postgresPassword] = readFileSync(0, "utf8").split("\0");
  const message = databaseUrlError(databaseUrl, postgresPassword);
  if (message) {
    console.error(message);
    process.exitCode = 1;
  }
}

module.exports = { databaseUrlError };

if (require.main === module) {
  checkDatabaseUrlFromStdin();
}
