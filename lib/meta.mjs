import { requireEnv } from "./env.mjs";

// Shared client for Meta's Graph API (WhatsApp, Instagram and Facebook).
const VERSION = () => process.env.META_GRAPH_VERSION || "v26.0";
export const token = () => requireEnv("META_ACCESS_TOKEN", "Meta Business Settings > System users > Generate token");

export async function graph(method, route, params = {}, { host = "graph.facebook.com", accessToken = token() } = {}) {
  const url = new URL(`https://${host}/${VERSION()}/${route}`);
  const init = { method, headers: { Authorization: `Bearer ${accessToken}` } };
  if (params instanceof FormData) init.body = params;
  else if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  else {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(params);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Meta ${method} ${route} -> ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
  return data;
}
