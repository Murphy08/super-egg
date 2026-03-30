const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = path.resolve(__dirname, "..");
const EVENT_TIME_ZONE = "Asia/Shanghai";
const RELEASE_START_AT_MS = Date.parse("2026-04-17T20:40:00+08:00");
// const RELEASE_START_AT_MS = Date.parse('2026-03-30T09:57:00+08:00');
const RELEASE_INTERVAL_MS = 10 * 60 * 1000;
const RELEASE_BATCH_SIZE = 2;

const TIP_FILES = [
  {
    id: "tip-01",
    order: 1,
    title: "提示 01",
    description: "活动区域与关键线索，请优先确认。",
    imagePath: "/assets/img/super/59435922338335202274660035944300.png",
  },
  {
    id: "tip-02",
    order: 2,
    title: "提示 02",
    description: "合理规划起点，可以节省不少搜索时间。",
    imagePath: "/assets/img/super/20136952057279329852041941419384.png",
  },
  {
    id: "tip-03",
    order: 3,
    title: "提示 03",
    description: "注意彩蛋前缀与工作人员名称的对应关系。",
    imagePath: "/assets/img/super/53277708078166020209413242024120.png",
  },
  {
    id: "tip-04",
    order: 4,
    title: "提示 04",
    description: "到达目标后及时截图，避免有效凭证缺失。",
    imagePath: "/assets/img/super/67841981383065483760247596055086.png",
  },
  {
    id: "tip-05",
    order: 5,
    title: "提示 05",
    description: "无需挂车，轻装上阵会更利于快速转场。",
    imagePath: "/assets/img/super/32812690883133668826005938885003.png",
  },
  {
    id: "tip-06",
    order: 6,
    title: "提示 06",
    description: "请勿使用 TPC 工具，否则成绩可能失效。",
    imagePath: "/assets/img/super/64582626208467561653239797877373.png",
  },
];

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getReleaseState(nowMs = Date.now()) {
  const hasStarted = nowMs >= RELEASE_START_AT_MS;
  const elapsedMs = hasStarted ? nowMs - RELEASE_START_AT_MS : 0;
  const batchIndex = hasStarted
    ? Math.floor(elapsedMs / RELEASE_INTERVAL_MS)
    : -1;
  const releasedCount = hasStarted
    ? Math.min(TIP_FILES.length, (batchIndex + 1) * RELEASE_BATCH_SIZE)
    : 0;
  const nextReleaseAtMs =
    releasedCount >= TIP_FILES.length
      ? null
      : hasStarted
        ? RELEASE_START_AT_MS + (batchIndex + 1) * RELEASE_INTERVAL_MS
        : RELEASE_START_AT_MS;

  return {
    status:
      releasedCount === 0
        ? "pending"
        : releasedCount >= TIP_FILES.length
          ? "finished"
          : "running",
    eventTimeZone: EVENT_TIME_ZONE,
    releaseStartAtMs: RELEASE_START_AT_MS,
    releaseIntervalMinutes: RELEASE_INTERVAL_MS / 60000,
    releaseBatchSize: RELEASE_BATCH_SIZE,
    totalTips: TIP_FILES.length,
    releasedCount,
    hiddenCount: TIP_FILES.length - releasedCount,
    nextReleaseAtMs,
    visibleTips: TIP_FILES.slice(0, releasedCount),
  };
}

function buildApiPayload(nowMs = Date.now()) {
  return {
    serverTimeMs: nowMs,
    ...getReleaseState(nowMs),
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(message);
}

function isProtectedTipImage(urlPath) {
  return TIP_FILES.some((tip) => tip.imagePath === urlPath);
}

function isTipReleased(urlPath, nowMs = Date.now()) {
  const state = getReleaseState(nowMs);
  return state.visibleTips.some((tip) => tip.imagePath === urlPath);
}

function resolveFilePath(urlPath) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const relativePath = safePath.startsWith("/") ? safePath.slice(1) : safePath;
  const normalizedPath = path.normalize(decodeURIComponent(relativePath));

  if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
    return null;
  }

  const filePath = path.resolve(ROOT_DIR, normalizedPath);

  if (!filePath.startsWith(ROOT_DIR)) {
    return null;
  }

  return filePath;
}

function serveStaticFile(req, res, urlPath) {
  const nowMs = Date.now();

  if (isProtectedTipImage(urlPath) && !isTipReleased(urlPath, nowMs)) {
    return sendText(
      res,
      403,
      "The requested tip image has not been released yet.",
    );
  }

  const filePath = resolveFilePath(urlPath);
  if (!filePath) {
    return sendText(res, 403, "Forbidden");
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      return sendText(res, 404, "Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
    };

    if (isProtectedTipImage(urlPath)) {
      headers["Cache-Control"] = "no-store";
    }

    res.writeHead(200, headers);

    if (req.method === "HEAD") {
      return res.end();
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) {
        sendText(res, 500, "Internal Server Error");
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  });
}

function requestHandler(req, res) {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`,
  );

  if (requestUrl.pathname === "/api") {
    if (req.method !== "GET") {
      return sendJson(res, 405, { message: "Method Not Allowed" });
    }

    return sendJson(res, 200, buildApiPayload());
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(res, 405, "Method Not Allowed");
  }

  return serveStaticFile(req, res, requestUrl.pathname);
}

function createServer() {
  return http.createServer(requestHandler);
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Super Egg server running at http://localhost:${PORT}`);
    console.log("Tips release schedule starts at 2026-04-17 20:40:00 (UTC+8).");
  });
}

module.exports = {
  TIP_FILES,
  buildApiPayload,
  createServer,
  getReleaseState,
  RELEASE_BATCH_SIZE,
  RELEASE_INTERVAL_MS,
  RELEASE_START_AT_MS,
};
