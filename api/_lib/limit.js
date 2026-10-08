// 레이트 리밋: IP당 분당 5회·하루 30회, 사이트 전체 하루 130회.
// 카운터는 Upstash Redis REST API에 둔다(라이브러리 없이 fetch 한 번). IP는 날마다 바뀌는 해시로만 키에 쓴다.
import { createHash } from "node:crypto";

export const LIMITS = { perMinute: 5, perDay: 30, siteDay: 130 };

const memory = new Map(); // Redis가 없는 로컬·미리보기용(인스턴스마다 따로 센다)

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

async function incrAll(keys) {
  const cfg = redisConfig();
  if (!cfg) {
    if (process.env.VERCEL_ENV === "production") throw new Error("rate limiter not configured");
    return keys.map(([k]) => {
      const n = (memory.get(k) || 0) + 1;
      memory.set(k, n);
      return n;
    });
  }
  const commands = keys.flatMap(([k, ttl]) => [["INCR", k], ["EXPIRE", k, String(ttl), "NX"]]);
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`rate limiter ${res.status}`);
  const out = await res.json();
  return keys.map((_, i) => out[i * 2].result);
}

/** @returns {Promise<null | "minute" | "day" | "site">} 막혔으면 이유 */
export async function hit(ip, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const minute = Math.floor(now.getTime() / 60000);
  const who = createHash("sha256").update(`${day}:${ip}`).digest("hex").slice(0, 16);
  const [m, d] = await incrAll([
    [`ask:m:${who}:${minute}`, 90],
    [`ask:d:${who}:${day}`, 90000],
  ]);
  if (d > LIMITS.perDay) return "day";
  if (m > LIMITS.perMinute) return "minute";
  // 한 사람이 막힌 요청을 퍼부어도 사이트 전체 몫이 줄지 않게, 개인 한도를 넘지 않은 요청만 센다
  const [s] = await incrAll([[`ask:s:${day}`, 90000]]);
  if (s > LIMITS.siteDay) return "site";
  return null;
}
