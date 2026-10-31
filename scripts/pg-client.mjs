import pg from "pg";

function connectionStringFrom(url) {
  const trimmed = url.trim().replace(/^['"]|['"]$/g, "");
  const queryStart = trimmed.indexOf("?");
  if (queryStart === -1) return trimmed;

  const base = trimmed.slice(0, queryStart);
  const kept = trimmed
    .slice(queryStart + 1)
    .split("&")
    .filter((pair) => {
      const key = pair.split("=")[0];
      return key !== "sslmode" && key !== "channel_binding";
    });

  return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}

export function createPgClient(url) {
  return new pg.Client({
    connectionString: connectionStringFrom(url),
    ssl: { rejectUnauthorized: false },
  });
}
