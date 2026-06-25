const { erlcBaseUrl, erlcPlayersPath } = require("./config");

class ErlcApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ErlcApiError";
    this.status = status;
    this.body = body;
  }
}

async function erlcRequest(path, serverKey, options = {}) {
  if (!serverKey) {
    throw new ErlcApiError("This Discord server has not set an ER:LC API key yet.", 400, null);
  }

  const url = new URL(`${erlcBaseUrl}${path}`);

  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      "server-key": serverKey,
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body?.message
        ? body.message
        : `ER:LC API request failed with HTTP ${response.status}`;

    throw new ErlcApiError(message, response.status, body);
  }

  return body;
}

async function fetchServerInfo(serverKey, extraFields = {}) {
  return erlcRequest("/server", serverKey, {
    query: Object.fromEntries(
      Object.entries(extraFields).map(([key, value]) => [key, value ? "true" : undefined])
    )
  });
}

async function fetchServerPlayers(serverKey) {
  const body = await erlcRequest(erlcPlayersPath, serverKey);

  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.players)) return body.players;
  if (Array.isArray(body?.Players)) return body.Players;

  return [];
}

async function runServerCommand(serverKey, command) {
  return erlcRequest("/server/command", serverKey, {
    method: "POST",
    body: { command }
  });
}

module.exports = {
  ErlcApiError,
  fetchServerInfo,
  fetchServerPlayers,
  runServerCommand
};
