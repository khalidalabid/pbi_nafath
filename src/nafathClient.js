const https = require("https");
const { URL } = require("url");
const config = require("./config");

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}000`;
}

function buildHeaders() {
  if (!config.nafath.apiKey) {
    throw new Error("NAFATH_API_KEY is not configured");
  }

  return {
    accept: "application/json",
    "X-Request-Id": config.nafath.clientId,
    "Accept-Language": config.nafath.acceptLanguage,
    "X-Client-Timestamp": formatTimestamp(),
    "Content-Type": "application/json",
    ApiKey: config.nafath.apiKey
  };
}

function httpsPost(url, headers, bodyJson) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(bodyJson)
      },
      minVersion: "TLSv1.2"
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        // console.log(`[Nafath] <-- HTTP ${res.statusCode}`);
        // console.log(`[Nafath]     raw body: ${body || "(empty)"}`);
        let data;
        try {
          data = body ? JSON.parse(body) : {};
        } catch {
          reject(new Error(`Invalid JSON from Nafath gateway (HTTP ${res.statusCode}): ${body}`));
          return;
        }
        resolve(data);
      });
    });

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("Nafath request timed out after 30s"));
    });

    req.write(bodyJson);
    req.end();
  });
}

async function postJson(url, body, attempt = 1) {
  const headers = buildHeaders();
  const bodyJson = JSON.stringify(body);

  // console.log(`[Nafath] --> POST ${url} (attempt ${attempt})`);
  // console.log(`[Nafath]     body: ${bodyJson}`);
  // console.log(`[Nafath]     X-Request-Id: ${headers["X-Request-Id"]}`);

  try {
    return await httpsPost(url, headers, bodyJson);
  } catch (err) {
    // WSO2 sometimes resets the connection on first attempt — retry once
    if (attempt === 1 && (err.code === "ECONNRESET" || err.code === "ETIMEDOUT")) {
      console.warn(`[Nafath] ${err.code} on attempt 1, retrying...`);
      return postJson(url, body, 2);
    }
    throw new Error(`Nafath request failed: ${err.message}`);
  }
}

function searchForKey(value, predicate) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = searchForKey(item, predicate);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (predicate(key, nestedValue)) {
        return nestedValue;
      }

      const result = searchForKey(nestedValue, predicate);
      if (result !== undefined) {
        return result;
      }
    }
  }

  return undefined;
}

function tryParseJsonString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  if (!text || (text[0] !== "{" && text[0] !== "[")) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function normalizePayload(payload) {
  const embedded = searchForKey(payload, (key, value) => {
    const normalized = key.toLowerCase();
    return ["data", "result", "payload", "response"].includes(normalized) && typeof value === "string";
  });

  const parsedEmbedded = tryParseJsonString(embedded);
  if (parsedEmbedded) {
    return parsedEmbedded;
  }

  return payload;
}

function getByExactKeys(payload, keys) {
  return searchForKey(payload, (key, value) => {
    return typeof value === "string" && keys.includes(key.toLowerCase());
  });
}

function getByPartialKeys(payload, partials) {
  return searchForKey(payload, (key, value) => {
    if (!(typeof value === "string" || typeof value === "number")) {
      return false;
    }

    const normalized = key.toLowerCase();
    return partials.some((part) => normalized.includes(part));
  });
}

function extractTransactionId(payload) {
  const normalized = normalizePayload(payload);
  const directTransactionId =
    getByExactKeys(normalized, ["transactionid", "transid", "txnid"]) ||
    getByPartialKeys(normalized, ["transaction", "trans", "txn"]);

  if (directTransactionId) {
    return directTransactionId;
  }

  return (
    getByExactKeys(normalized, ["requestid", "requestidvalue"]) ||
    getByPartialKeys(normalized, ["request"])
  );
}

function extractRandom(payload) {
  const normalized = normalizePayload(payload);
  const value =
    searchForKey(normalized, (key, nestedValue) => {
      const normalizedKey = key.toLowerCase();
      return ["random", "randomnumber", "randomnum", "challenge", "otpindex"].includes(normalizedKey) &&
        (typeof nestedValue === "string" || typeof nestedValue === "number");
    }) ||
    getByPartialKeys(normalized, ["random", "challenge", "otp"]);

  return value === undefined ? undefined : String(value);
}

function extractAccessToken(payload) {
  return searchForKey(payload, (key, value) => typeof value === "string" && key.toLowerCase() === "accesstoken");
}

function extractStatus(payload) {
  const status = searchForKey(payload, (key, value) => {
    const normalizedKey = key.toLowerCase();
    return ["status", "requeststatus", "loginstatus"].includes(normalizedKey) && typeof value === "string";
  });

  return typeof status === "string" ? status : "";
}

function normalizeStatus(status) {
  return status.toLowerCase().replace(/[^a-z]/g, "");
}

function classifyStatus(payload) {
  const accessToken = extractAccessToken(payload);

  const rawStatus = extractStatus(payload);
  const normalized = normalizeStatus(rawStatus);

  // Swagger-defined values: COMPLETED, WAITING, REJECTED, EXPIRED
  if (["completed", "approved", "success", "succeeded", "verified", "accepted", "done"].includes(normalized)) {
    return { state: "approved", accessToken: accessToken || "", rawStatus };
  }

  if (["rejected", "failed", "denied", "declined", "cancelled", "canceled", "expired", "timeout"].includes(normalized)) {
    return { state: "rejected", accessToken: "", rawStatus };
  }

  // WAITING or anything else → still pending
  return { state: "pending", accessToken: "", rawStatus };
}

async function startLoginRequest(nationalId) {
  const payload = await postJson(config.nafath.sendUrl, {
    action: "SpRequest",
    parameters: {
      service: config.nafath.service,
      id: nationalId
    }
  });

  const transactionId = extractTransactionId(payload);
  const random = extractRandom(payload);

  if (!transactionId || !random) {
    const compact = JSON.stringify(payload);
    throw new Error(`Nafath send response did not include transactionId and random value. Response: ${compact}`);
  }

  return {
    transactionId,
    random,
    raw: payload
  };
}

async function checkRequestStatus({ transactionId, nationalId, random }) {
  const payload = await postJson(config.nafath.statusUrl, {
    action: "CheckSpRequest",
    parameters: {
      transactionId,
      id: nationalId,
      random
    }
  });

  return {
    ...classifyStatus(payload),
    raw: payload
  };
}

module.exports = {
  startLoginRequest,
  checkRequestStatus
};
