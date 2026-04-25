const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// ========== 閰嶇疆 ==========
const ADMIN_KEY = process.env.ADMIN_KEY || "yulong-admin-2026";
const GITHUB_OWNER = "zhonghaorui";
const GITHUB_REPO = "anshan-yulong-apk";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const PORT = process.env.PORT || 3000;

// 鍐呭瓨瀛樺偍锛圧ailway 閲嶅惎浼氫涪澶憋紝鐢熶骇鐜寤鸿鐢ㄦ暟鎹簱锛?let codesStore = [
  {
    code: "YLON-2026-ANSH-ANLU",
    deviceLimit: 1,
    validityDays: 365,
    activatedAt: "",
    expiresAt: "",
    deviceId: "",
    blacklisted: false,
    note: "榛樿婵€娲荤爜",
    createdAt: "2026-01-01"
  }
];
let releaseCache = null;
let releaseCacheTime = 0;

// ========== 宸ュ叿鍑芥暟 ==========
function jsonResponse(res, data, status = 200) {
  res.status(status).json(data);
}

function calculateExpiry(activatedAt, validityDays) {
  if (!activatedAt || !validityDays) return "";
  const expireDate = new Date(activatedAt);
  expireDate.setDate(expireDate.getDate() + validityDays);
  return expireDate.toISOString().split("T")[0];
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

// ========== GitHub API 浠ｇ悊 ==========
async function getLatestRelease() {
  const now = Date.now();
  if (releaseCache && now - releaseCacheTime < 300000) {
    return releaseCache;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "Railway-App",
          ...(GITHUB_TOKEN ? { "Authorization": `token ${GITHUB_TOKEN}` } : {})
        }
      }
    );

    if (!response.ok) {
      console.error("GitHub API error:", response.status, await response.text());
      return null;
    }

    const release = await response.json();
    const apkAsset = release.assets?.find(
      (a) => a.name.endsWith(".apk") && a.state === "uploaded"
    );

    const data = {
      version: release.tag_name?.replace(/^v/, "") || "1.0.0",
      versionCode: parseInt(release.body?.match(/versionCode:\s*(\d+)/i)?.[1] || "1"),
      changelog: release.body || "",
      apkUrl: apkAsset?.browser_download_url || null,
      apkSize: apkAsset?.size || 0,
      forceUpdate: release.body?.includes("[FORCE_UPDATE]") || false,
      publishedAt: release.published_at
    };

    releaseCache = data;
    releaseCacheTime = now;
    return data;
  } catch (error) {
    console.error("getLatestRelease error:", error);
    return null;
  }
}

// ========== 璺敱 ==========

// 鍋ュ悍妫€鏌?app.get("/", (req, res) => {
  jsonResponse(res, {
    name: "闉嶅北娓旈殕婵€娲荤爜楠岃瘉 API",
    version: "2.1.0",
    status: "running",
    backend: "Railway",
    proxy: true
  });
});

// GitHub 浠ｇ悊绔偣
app.all("/proxy", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return jsonResponse(res, { error: "Missing url parameter" }, 400);
  }

  // 瀹夊叏妫€鏌?  const allowedHosts = [
    "api.github.com",
    "github.com",
    "raw.githubusercontent.com"
  ];
  const target = new URL(targetUrl);
  const isAllowed = allowedHosts.some(host => target.hostname.includes(host));
  if (!isAllowed) {
    return jsonResponse(res, { error: "URL not allowed", host: target.hostname }, 403);
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        "host": target.hostname
      },
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined
    });

    const body = await response.text();
    res.status(response.status);
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    
    // 杞彂 Content-Type
    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.set("Content-Type", contentType);
    }
    
    res.send(body);
  } catch (error) {
    console.error("Proxy error:", error);
    jsonResponse(res, { error: "Proxy failed", message: error.message }, 502);
  }
});

// 鏇存柊妫€鏌?app.get("/update/check", async (req, res) => {
  const currentVersionCode = parseInt(req.query.versionCode || "0");
  const release = await getLatestRelease();
  
  if (!release || !release.apkUrl) {
    return jsonResponse(res, { error: "no_release_found" }, 404);
  }

  const hasUpdate = release.versionCode > currentVersionCode;
  jsonResponse(res, {
    hasUpdate,
    version: release.version,
    versionCode: release.versionCode,
    forceUpdate: release.forceUpdate,
    changelog: release.changelog,
    apkUrl: hasUpdate ? release.apkUrl : null,
    apkSize: release.apkSize
  });
});

// 鏇存柊淇℃伅
app.get("/update/info", async (req, res) => {
  const release = await getLatestRelease();
  if (!release) {
    return jsonResponse(res, { error: "no_release_found" }, 404);
  }
  jsonResponse(res, release);
});

// 婵€娲荤爜楠岃瘉
app.get("/verify", async (req, res) => {
  const code = req.query.code;
  const deviceId = req.query.deviceId || "";
  
  if (!code) {
    return jsonResponse(res, { error: "missing code" }, 400);
  }

  const normalized = code.replace(/[-\s]/g, "");
  const match = codesStore.find((c) => c.code.replace(/[-\s]/g, "") === normalized);

  if (!match) {
    return jsonResponse(res, { success: false, error: "invalid_code", message: "婵€娲荤爜鏃犳晥" });
  }

  if (match.blacklisted) {
    return jsonResponse(res, { success: false, error: "blacklisted", message: "婵€娲荤爜宸茶绂佺敤" });
  }

  if (match.expiresAt && isExpired(match.expiresAt)) {
    return jsonResponse(res, { success: false, error: "expired", message: "婵€娲荤爜宸茶繃鏈?, expiresAt: match.expiresAt });
  }

  if (match.activatedAt) {
    return jsonResponse(res, {
      success: false,
      error: "already_activated",
      message: "婵€娲荤爜宸茶浣跨敤",
      activatedAt: match.activatedAt,
      expiresAt: match.expiresAt
    });
  }

  match.activatedAt = new Date().toISOString().split("T")[0];
  match.expiresAt = calculateExpiry(match.activatedAt, match.validityDays);
  if (deviceId) {
    match.deviceId = deviceId;
  }

  jsonResponse(res, {
    success: true,
    code: match.code,
    activatedAt: match.activatedAt,
    expiresAt: match.expiresAt,
    validityDays: match.validityDays,
    remainingDays: match.expiresAt ? Math.max(0, Math.ceil((new Date(match.expiresAt) - new Date()) / (1000 * 60 * 60 * 24))) : 0
  });
});

// 婵€娲荤爜鐘舵€佹煡璇?app.get("/status", (req, res) => {
  const code = req.query.code;
  const deviceId = req.query.deviceId || "";
  
  if (!code) {
    return jsonResponse(res, { error: "missing code" }, 400);
  }

  const normalized = code.replace(/[-\s]/g, "");
  const match = codesStore.find((c) => c.code.replace(/[-\s]/g, "") === normalized);

  if (!match) {
    return jsonResponse(res, { valid: false, error: "invalid_code" });
  }

  if (match.blacklisted) {
    return jsonResponse(res, { valid: false, error: "blacklisted", message: "婵€娲荤爜宸茶绂佺敤" });
  }

  if (match.expiresAt && isExpired(match.expiresAt)) {
    return jsonResponse(res, { valid: false, error: "expired", expiresAt: match.expiresAt });
  }

  if (match.deviceId && deviceId && match.deviceId !== deviceId) {
    return jsonResponse(res, { valid: false, error: "device_mismatch" });
  }

  jsonResponse(res, {
    valid: true,
    code: match.code,
    activatedAt: match.activatedAt,
    expiresAt: match.expiresAt,
    remainingDays: match.expiresAt ? Math.max(0, Math.ceil((new Date(match.expiresAt) - new Date()) / (1000 * 60 * 60 * 24))) : 0
  });
});

// ========== 绠＄悊鍚庡彴 ==========
app.get("/admin/list", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return jsonResponse(res, { error: "unauthorized" }, 403);
  jsonResponse(res, { success: true, codes: codesStore });
});

app.get("/admin/stats", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return jsonResponse(res, { error: "unauthorized" }, 403);
  
  jsonResponse(res, {
    success: true,
    total: codesStore.length,
    active: codesStore.filter((c) => !c.blacklisted && (!c.expiresAt || !isExpired(c.expiresAt))).length,
    blacklisted: codesStore.filter((c) => c.blacklisted).length,
    expired: codesStore.filter((c) => c.expiresAt && isExpired(c.expiresAt)).length
  });
});

app.post("/admin/add", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return jsonResponse(res, { error: "unauthorized" }, 403);

  const { code, validityDays = 365, deviceLimit = 1, note = "" } = req.body;
  if (!code) return jsonResponse(res, { error: "code required" }, 400);

  const normalized = code.replace(/[-\s]/g, "");
  if (codesStore.find((c) => c.code.replace(/[-\s]/g, "") === normalized)) {
    return jsonResponse(res, { error: "code already exists" }, 400);
  }

  codesStore.push({
    code,
    deviceLimit,
    validityDays,
    activatedAt: "",
    expiresAt: "",
    deviceId: "",
    blacklisted: false,
    note,
    createdAt: new Date().toISOString().split("T")[0]
  });

  jsonResponse(res, { success: true, code });
});

app.post("/admin/delete", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return jsonResponse(res, { error: "unauthorized" }, 403);

  const { code } = req.body;
  const normalized = code.replace(/[-\s]/g, "");
  const filtered = codesStore.filter((c) => c.code.replace(/[-\s]/g, "") !== normalized);
  
  if (filtered.length === codesStore.length) {
    return jsonResponse(res, { error: "code not found" }, 404);
  }
  
  codesStore = filtered;
  jsonResponse(res, { success: true });
});

app.post("/admin/blacklist", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return jsonResponse(res, { error: "unauthorized" }, 403);

  const { code, blacklisted = true } = req.body;
  const normalized = code.replace(/[-\s]/g, "");
  const match = codesStore.find((c) => c.code.replace(/[-\s]/g, "") === normalized);
  
  if (!match) {
    return jsonResponse(res, { error: "code not found" }, 404);
  }
  
  match.blacklisted = blacklisted;
  jsonResponse(res, { success: true, code: match.code, blacklisted });
});

app.post("/admin/reset", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return jsonResponse(res, { error: "unauthorized" }, 403);

  const { code } = req.body;
  const normalized = code.replace(/[-\s]/g, "");
  const match = codesStore.find((c) => c.code.replace(/[-\s]/g, "") === normalized);
  
  if (!match) {
    return jsonResponse(res, { error: "code not found" }, 404);
  }
  
  match.activatedAt = "";
  match.expiresAt = "";
  match.deviceId = "";
  match.blacklisted = false;
  jsonResponse(res, { success: true, code: match.code });
});

app.post("/admin/batch", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) return jsonResponse(res, { error: "unauthorized" }, 403);

  const { prefix, count, validityDays = 365, note = "" } = req.body;
  if (!prefix || !count) {
    return jsonResponse(res, { error: "prefix and count required" }, 400);
  }

  const added = [];
  for (let i = 1; i <= count; i++) {
    const suffix = String(i).padStart(3, "0");
    const code = `${prefix}-${suffix}`;
    const normalized = code.replace(/[-\s]/g, "");
    if (!codesStore.find((c) => c.code.replace(/[-\s]/g, "") === normalized)) {
      codesStore.push({
        code,
        deviceLimit: 1,
        validityDays,
        activatedAt: "",
        expiresAt: "",
        deviceId: "",
        blacklisted: false,
        note: note || `鎵归噺鐢熸垚 #${i}`,
        createdAt: new Date().toISOString().split("T")[0]
      });
      added.push(code);
    }
  }
  
  jsonResponse(res, { success: true, added: added.length, codes: added });
});

// 鍚姩鏈嶅姟鍣?app.listen(PORT, () => {
  console.log(`闉嶅北娓旈殕 API 鏈嶅姟杩愯鍦ㄧ鍙?${PORT}`);
  console.log(`浠ｇ悊鍔熻兘宸插惎鐢? /proxy?url=...`);
});
