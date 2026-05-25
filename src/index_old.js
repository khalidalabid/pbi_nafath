require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });

const express = require("express");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const bodyParser = require("express").json;
const cookieParser = require("cookie-parser");
const config = require("./config");
const nafathClient = require("./nafathClient");
const pbrsClient = require("./powerbiClient");

const app = express();
app.use(bodyParser());
app.use(cookieParser());

const whitelistFile = path.resolve(__dirname, "..", config.whitelistPath);
const loginSessions = new Map();
const sessionTtlMs = 5 * 60 * 1000;
const adminSessions = new Map();
const adminSessionTtlMs = 30 * 60 * 1000; // 30 minutes

function generateAdminToken() {
  return randomUUID();
}

function readWhitelist() {
  if (!fs.existsSync(whitelistFile)) {
    return { whitelist: [] };
  }
  return JSON.parse(fs.readFileSync(whitelistFile, "utf8"));
}

function writeWhitelist(wl) {
  fs.writeFileSync(whitelistFile, JSON.stringify(wl, null, 2), "utf8");
}

function findWhitelistEntry(nationalId) {
  const wl = readWhitelist();
  return wl.whitelist.find((item) => item.nationalId === nationalId);
}

function normalizeReportPath(inputPath) {
  if (typeof inputPath !== "string") {
    return "";
  }

  const trimmed = inputPath.trim();
  if (!trimmed) {
    return "";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const collapsedSlashes = withLeadingSlash.replace(/\/+/g, "/");
  const withoutTrailingSlash = collapsedSlashes.length > 1 ? collapsedSlashes.replace(/\/+$/, "") : collapsedSlashes;
  return withoutTrailingSlash.toLowerCase();
}

function isReportPathAllowed(entry, requestedPath) {
  if (!Array.isArray(entry?.allowedReports) || entry.allowedReports.length === 0) {
    return true;
  }

  const requestedNormalized = normalizeReportPath(requestedPath);
  const allowedNormalized = entry.allowedReports.map((value) => normalizeReportPath(value));
  return allowedNormalized.includes(requestedNormalized);
}

function resolveDashboardPath(entry) {
  if (Array.isArray(entry.allowedReports) && entry.allowedReports.length > 0) {
    return entry.allowedReports[0];
  }

  return config.nafath.defaultDashboardPath;
}

function createSession(entry, nationalId, transactionId, random) {
  const dashboardPath = resolveDashboardPath(entry);
  const directUrl = pbrsClient.generateDirectAccessUrl(dashboardPath, entry.localAdUser);
  const session = {
    id: randomUUID(),
    nationalId,
    transactionId,
    random,
    dashboardPath,
    directUrl,
    displayName: entry.displayName,
    localAdUser: entry.localAdUser,
    createdAt: Date.now()
  };

  loginSessions.set(transactionId, session);
  return session;
}

function getActiveSession(transactionId) {
  const session = loginSessions.get(transactionId);
  if (!session) {
    return null;
  }

  if (Date.now() - session.createdAt > sessionTtlMs) {
    loginSessions.delete(transactionId);
    return null;
  }

  return session;
}

function renderCitizenEntryPage() {
  return `<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RASED Access</title>
  <style>
    :root {
      --bg: #f4efe4;
      --panel: #fffaf0;
      --ink: #1f2a1f;
      --muted: #55614d;
      --accent: #1f6b52;
      --accent-2: #d6a74f;
      --danger: #9e2a2b;
      --border: rgba(31, 42, 31, 0.12);
      --shadow: 0 24px 60px rgba(54, 58, 43, 0.16);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(214, 167, 79, 0.24), transparent 28%),
        linear-gradient(135deg, #ebe2cf 0%, var(--bg) 42%, #dbe7de 100%);
      color: var(--ink);
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .shell {
      width: min(720px, 100%);
      background: rgba(255, 250, 240, 0.94);
      backdrop-filter: blur(10px);
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .hero {
      padding: 32px 32px 20px;
      background: linear-gradient(145deg, rgba(31, 107, 82, 0.92), rgba(37, 73, 56, 0.92));
      color: #f7f3eb;
    }

    .hero h1 {
      margin: 0 0 12px;
      font-size: clamp(2rem, 4vw, 3rem);
      letter-spacing: 0.02em;
    }

    .hero p {
      margin: 0;
      max-width: 54ch;
      color: rgba(247, 243, 235, 0.86);
      line-height: 1.6;
    }

    .body {
      padding: 28px 32px 32px;
    }

    form {
      display: grid;
      gap: 16px;
    }

    label {
      font-size: 0.95rem;
      color: var(--muted);
    }

    input {
      width: 100%;
      padding: 16px 18px;
      border-radius: 14px;
      border: 1px solid rgba(31, 42, 31, 0.18);
      font-size: 1.1rem;
      background: rgba(255, 255, 255, 0.8);
    }

    button {
      appearance: none;
      border: 0;
      border-radius: 14px;
      padding: 16px 18px;
      background: linear-gradient(135deg, var(--accent), #255d48);
      color: white;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
    }

    button[disabled] {
      opacity: 0.6;
      cursor: wait;
    }

    .status {
      margin-top: 20px;
      padding: 18px;
      border-radius: 16px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.66);
      display: none;
    }

    .status.visible {
      display: block;
      animation: fadeIn 220ms ease;
    }

    .random-box {
      display: inline-grid;
      place-items: center;
      min-width: 110px;
      margin: 12px 0;
      padding: 16px 20px;
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(214, 167, 79, 0.2), rgba(31, 107, 82, 0.12));
      color: var(--accent);
      font-size: 2.1rem;
      font-weight: 800;
      letter-spacing: 0.08em;
    }

    .hint {
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
    }

    .error {
      color: var(--danger);
      font-weight: 700;
    }

    .success {
      color: var(--accent);
      font-weight: 700;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <h1>RASED Dashboard Access</h1>
      <p>Enter the citizen national ID, approve the matching number in Nafath on the mobile device, and you will be redirected automatically when verification is completed.</p>
    </section>
    <section class="body">
      <form id="loginForm">
        <div>
          <label for="nationalId">National ID</label>
          <input id="nationalId" name="nationalId" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="Enter national ID" required>
        </div>
        <button id="submitBtn" type="submit">Start Nafath Verification</button>
      </form>

      <section id="statusCard" class="status" aria-live="polite">
        <p id="message" class="hint"></p>
        <div id="randomBox" class="random-box" hidden>--</div>
        <p id="subMessage" class="hint"></p>
      </section>
    </section>
  </main>

  <script>
    const form = document.getElementById("loginForm");
    const submitBtn = document.getElementById("submitBtn");
    const statusCard = document.getElementById("statusCard");
    const message = document.getElementById("message");
    const subMessage = document.getElementById("subMessage");
    const randomBox = document.getElementById("randomBox");
    let pollTimer = null;

    function showStatus(text, detail, variant, randomValue) {
      statusCard.classList.add("visible");
      message.textContent = text;
      message.className = variant ? variant : "hint";
      subMessage.textContent = detail || "";

      if (randomValue) {
        randomBox.hidden = false;
        randomBox.textContent = randomValue;
      } else {
        randomBox.hidden = true;
      }
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    async function checkStatus(transactionId) {
      const response = await fetch("/nafath/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.details ? (data.error + ": " + data.details) : (data.error || "Status check failed"));
      }

      if (data.state === "approved" && data.redirectUrl) {
        stopPolling();
        showStatus("Verification completed.", "Redirecting to your assigned dashboard.", "success", data.random);
        window.location.assign(data.redirectUrl);
        return;
      }

      if (data.state === "rejected") {
        stopPolling();
        showStatus("Verification was not approved.", data.message || "The request was rejected or expired.", "error", data.random);
        submitBtn.disabled = false;
        return;
      }

      showStatus("Waiting for Nafath approval.", data.message || "Choose the matching number in the Nafath app to continue.", "hint", data.random);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      stopPolling();

      const nationalId = document.getElementById("nationalId").value.trim();
      submitBtn.disabled = true;
      showStatus("Sending request to Nafath.", "Please wait...", "hint");

      try {
        const response = await fetch("/nafath/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nationalId })
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.details ? (data.error + ": " + data.details) : (data.error || "Unable to start Nafath verification"));
        }

        showStatus(
          "Open Nafath on your mobile device.",
          "Select the OTP that matches the random number shown below.",
          "hint",
          data.random
        );

        pollTimer = setInterval(() => {
          checkStatus(data.transactionId).catch((error) => {
            stopPolling();
            submitBtn.disabled = false;
            showStatus("Unable to verify the Nafath request.", error.message, "error", data.random);
          });
        }, 3000);

        checkStatus(data.transactionId).catch((error) => {
          stopPolling();
          submitBtn.disabled = false;
          showStatus("Unable to verify the Nafath request.", error.message, "error", data.random);
        });
      } catch (error) {
        submitBtn.disabled = false;
        showStatus("Unable to start Nafath verification.", error.message, "error");
      }
    });
  </script>
</body>
</html>`;
}

setInterval(() => {
  for (const [transactionId, session] of loginSessions.entries()) {
    if (Date.now() - session.createdAt > sessionTtlMs) {
      loginSessions.delete(transactionId);
    }
  }
}, 60 * 1000).unref();

app.get("/health", (req, res) => {
  res.json({ status: "ok", mode: "PBIRS on-prem with Windows Auth" });
});

app.get("/whitelist", (req, res) => {
  const wl = readWhitelist();
  res.json(wl);
});

app.post("/whitelist", (req, res) => {
  const { nationalId, localAdUser, displayName, allowedReports } = req.body;
  if (!nationalId || !localAdUser) {
    return res.status(400).json({ error: "nationalId and localAdUser are required" });
  }

  const wl = readWhitelist();
  const existing = wl.whitelist.find((item) => item.nationalId === nationalId);
  if (existing) {
    existing.localAdUser = localAdUser;
    existing.displayName = displayName || existing.displayName;
    existing.allowedReports = allowedReports || existing.allowedReports;
  } else {
    wl.whitelist.push({ nationalId, localAdUser, displayName: displayName || "", allowedReports: allowedReports || [] });
  }
  writeWhitelist(wl);
  res.json({ success: true, entry: existing || wl.whitelist[wl.whitelist.length - 1] });
});

app.post("/access", async (req, res) => {
  try {
    const { nationalId, reportPath } = req.body;
    if (!nationalId || !reportPath) {
      return res.status(400).json({ error: "nationalId and reportPath are required" });
    }

    const wl = readWhitelist();
    const entry = wl.whitelist.find((item) => item.nationalId === nationalId);
    if (!entry) {
      return res.status(403).json({ error: "nationalId not whitelisted" });
    }

    if (!isReportPathAllowed(entry, reportPath)) {
      return res.status(403).json({ error: "reportPath not allowed for this user" });
    }

    // For PBIRS on-prem with Windows Auth, return direct report URL
    // The client browser will authenticate with Windows SSO
    const directUrl = pbrsClient.generateDirectAccessUrl(reportPath, entry.localAdUser);

    res.json({
      success: true,
      reportPath,
      directUrl,
      localAdUser: entry.localAdUser,
      displayName: entry.displayName,
      note: "Access this URL in a domain-joined browser for automatic Windows authentication"
    });
  } catch (err) {
    console.error(err.message || err);
    res.status(500).json({ error: "failed to generate access URL", details: err.message });
  }
});

app.post("/nafath/start", async (req, res) => {
  try {
    const nationalId = String(req.body?.nationalId || "").trim();
    if (!/^\d{10}$/.test(nationalId)) {
      return res.status(400).json({ error: "nationalId must be a 10-digit number" });
    }

    const entry = findWhitelistEntry(nationalId);
    if (!entry) {
      return res.status(403).json({ error: "nationalId not whitelisted" });
    }

    const { transactionId, random } = await nafathClient.startLoginRequest(nationalId);
    const session = createSession(entry, nationalId, transactionId, random);

    res.json({
      success: true,
      transactionId: session.transactionId,
      random: session.random,
      displayName: session.displayName,
      dashboardPath: session.dashboardPath
    });
  } catch (err) {
    console.error(err.message || err);
    res.status(500).json({ error: "failed to start Nafath verification", details: err.message });
  }
});

app.post("/nafath/status", async (req, res) => {
  try {
    const transactionId = String(req.body?.transactionId || "").trim();
    if (!transactionId) {
      return res.status(400).json({ error: "transactionId is required" });
    }

    const session = getActiveSession(transactionId);
    if (!session) {
      return res.status(404).json({ error: "Nafath session not found or expired" });
    }

    const result = await nafathClient.checkRequestStatus({
      transactionId: session.transactionId,
      nationalId: session.nationalId,
      random: session.random
    });

    if (result.state === "approved") {
      const entry = findWhitelistEntry(session.nationalId);
      if (!entry) {
        loginSessions.delete(transactionId);
        return res.status(403).json({ error: "nationalId not whitelisted" });
      }

      if (!isReportPathAllowed(entry, session.dashboardPath)) {
        loginSessions.delete(transactionId);
        return res.status(403).json({ error: "dashboard not allowed for this user" });
      }

      loginSessions.delete(transactionId);
      return res.json({
        success: true,
        state: "approved",
        random: session.random,
        redirectUrl: session.directUrl,
        dashboardPath: session.dashboardPath,
        accessToken: result.accessToken || ""
      });
    }

    if (result.state === "rejected") {
      loginSessions.delete(transactionId);
    }

    res.json({
      success: true,
      state: result.state,
      random: session.random,
      message: result.rawStatus || "Waiting for approval in Nafath."
    });
  } catch (err) {
    console.error(err.message || err);
    res.status(500).json({ error: "failed to check Nafath status", details: err.message });
  }
});

app.get("/reports", async (req, res) => {
  try {
    const reports = await pbrsClient.listReports();
    res.json(reports);
  } catch (err) {
    console.error(err.message || err);
    res.status(500).json({ error: "failed to list reports", details: err.message });
  }
});

app.get("/", (req, res) => {
  res.type("html").send(renderCitizenEntryPage());
});

// ===== ADMIN PANEL ROUTES =====

function renderAdminLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login - RASED</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .shell {
      width: min(400px, 100%);
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }
    .header {
      padding: 32px 32px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .header h1 {
      margin: 0;
      font-size: 1.8rem;
      letter-spacing: 0.02em;
    }
    .body {
      padding: 32px;
    }
    form {
      display: grid;
      gap: 16px;
    }
    label {
      font-size: 0.95rem;
      color: #333;
      font-weight: 500;
    }
    input {
      width: 100%;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid #ddd;
      font-size: 1rem;
    }
    button {
      appearance: none;
      border: 0;
      border-radius: 8px;
      padding: 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover {
      opacity: 0.9;
    }
    .error {
      color: #d32f2f;
      background: #ffebee;
      padding: 12px;
      border-radius: 8px;
      display: none;
    }
    .error.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <h1>Admin Panel</h1>
    </div>
    <div class="body">
      <form id="loginForm">
        <div>
          <label for="username">Username</label>
          <input type="text" id="username" name="username" required>
        </div>
        <div>
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required>
        </div>
        <button type="submit">Login</button>
        <div class="error" id="error"></div>
      </form>
    </div>
  </div>
  <script>
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("username").value;
      const password = document.getElementById("password").value;
      const errorDiv = document.getElementById("error");
      errorDiv.classList.remove("show");

      try {
        const response = await fetch("/secadmin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Login failed");
        }
        window.location.href = "/secadmin";
      } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.classList.add("show");
      }
    });
  </script>
</body>
</html>`;
}

function renderAdminDashboard(whitelistData) {
  const whitelistRows = whitelistData.whitelist.map((user) => {
    const reports = (user.allowedReports || []).join(", ") || "All";
    return `
    <tr>
      <td>${user.nationalId}</td>
      <td>${user.displayName || "-"}</td>
      <td>${user.localAdUser}</td>
      <td>${reports}</td>
      <td>
        <button class="btn-edit" onclick="editUser('${user.nationalId}')">Edit</button>
        <button class="btn-delete" onclick="deleteUser('${user.nationalId}')">Delete</button>
      </td>
    </tr>
    `;
  }).join("");

  const tableHtml = whitelistData.whitelist.length === 0 
    ? "<p>No whitelisted users yet.</p>"
    : `
      <table>
        <thead>
          <tr>
            <th>National ID</th>
            <th>Display Name</th>
            <th>Local AD User</th>
            <th>Allowed Reports</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${whitelistRows}
        </tbody>
      </table>
    `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard - RASED</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding: 20px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .header h1 {
      margin: 0;
      color: #333;
    }
    .logout-btn {
      background: #d32f2f;
      color: white;
      border: 0;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .logout-btn:hover {
      background: #b71c1c;
    }
    .section {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      margin-bottom: 20px;
      padding: 20px;
    }
    .section h2 {
      margin-top: 0;
      margin-bottom: 20px;
      color: #333;
      border-bottom: 2px solid #667eea;
      padding-bottom: 10px;
    }
    .form-group {
      display: grid;
      gap: 12px;
      margin-bottom: 16px;
    }
    label {
      font-weight: 500;
      color: #333;
    }
    input, textarea {
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 1rem;
      font-family: inherit;
    }
    textarea {
      resize: vertical;
      min-height: 60px;
    }
    .btn {
      background: #667eea;
      color: white;
      border: 0;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .btn:hover {
      background: #5568d3;
    }
    .btn-delete {
      background: #d32f2f;
    }
    .btn-delete:hover {
      background: #b71c1c;
    }
    .btn-edit {
      background: #1976d2;
    }
    .btn-edit:hover {
      background: #1565c0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th {
      background: #f5f5f5;
      font-weight: 600;
      color: #333;
    }
    tr:hover {
      background: #f9f9f9;
    }
    .message {
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 16px;
      display: none;
    }
    .message.show {
      display: block;
    }
    .success {
      background: #c8e6c9;
      color: #2e7d32;
      border: 1px solid #81c784;
    }
    .error {
      background: #ffcdd2;
      color: #c62828;
      border: 1px solid #ef9a9a;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>RASED Admin Panel - Whitelist Management</h1>
      <button class="logout-btn" onclick="logout()">Logout</button>
    </div>

    <div class="section">
      <h2>Add/Edit User</h2>
      <div id="message" class="message"></div>
      <form id="userForm">
        <div class="form-group">
          <label for="nationalId">National ID (10 digits) *</label>
          <input type="text" id="nationalId" name="nationalId" pattern="\\d{10}" placeholder="e.g., 1234567890" required>
        </div>
        <div class="form-group">
          <label for="displayName">Display Name</label>
          <input type="text" id="displayName" name="displayName" placeholder="e.g., John Doe">
        </div>
        <div class="form-group">
          <label for="localAdUser">Local AD User *</label>
          <input type="text" id="localAdUser" name="localAdUser" placeholder="e.g., DOMAIN\\\\username" required>
        </div>
        <div class="form-group">
          <label for="allowedReports">Allowed Report Paths (comma-separated, leave empty for all)</label>
          <textarea id="allowedReports" name="allowedReports" placeholder="/powerbi/report1, /powerbi/report2"></textarea>
        </div>
        <button type="submit" class="btn">Add/Update User</button>
      </form>
    </div>

    <div class="section">
      <h2>Whitelisted Users (${whitelistData.whitelist.length})</h2>
      ${tableHtml}
    </div>
  </div>

  <script>
    function showMessage(text, type) {
      const msg = document.getElementById("message");
      msg.textContent = text;
      msg.className = "message show " + type;
      setTimeout(() => msg.classList.remove("show"), 3000);
    }

    document.getElementById("userForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const nationalId = document.getElementById("nationalId").value.trim();
      const displayName = document.getElementById("displayName").value.trim();
      const localAdUser = document.getElementById("localAdUser").value.trim();
      const allowedReportsText = document.getElementById("allowedReports").value.trim();
      const allowedReports = allowedReportsText ? allowedReportsText.split(",").map(r => r.trim()) : [];

      try {
        const response = await fetch("/secadmin/api/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nationalId, displayName, localAdUser, allowedReports })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to add/update user");
        }
        showMessage("User added/updated successfully", "success");
        document.getElementById("userForm").reset();
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        showMessage(err.message, "error");
      }
    });

    function editUser(nationalId) {
      const tr = event.target.closest("tr");
      const cells = tr.querySelectorAll("td");
      document.getElementById("nationalId").value = nationalId;
      document.getElementById("displayName").value = cells[1].textContent;
      document.getElementById("localAdUser").value = cells[2].textContent;
      const reports = cells[3].textContent;
      document.getElementById("allowedReports").value = reports === "All" ? "" : reports;
      document.getElementById("nationalId").focus();
    }

    function deleteUser(nationalId) {
      if (!confirm("Delete user " + nationalId + "?")) return;
      fetch("/secadmin/api/user/" + nationalId, { method: "DELETE" })
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            showMessage("User deleted successfully", "success");
            setTimeout(() => location.reload(), 1500);
          } else {
            showMessage(d.error || "Failed to delete user", "error");
          }
        })
        .catch(err => showMessage(err.message, "error"));
    }

    function logout() {
      fetch("/secadmin/logout", { method: "POST" })
        .then(() => window.location.href = "/secadmin")
        .catch(err => alert("Logout error: " + err.message));
    }
  </script>
</body>
</html>`;
}

function isAdminAuthenticated(req) {
  const token = req.cookies.adminToken;
  if (!token) return false;
  
  const session = adminSessions.get(token);
  if (!session) return false;
  
  if (Date.now() - session.createdAt > adminSessionTtlMs) {
    adminSessions.delete(token);
    return false;
  }
  
  return true;
}

// Admin Login
app.post("/secadmin/login", (req, res) => {
  const { username, password } = req.body;
  
  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  
  const token = generateAdminToken();
  adminSessions.set(token, { createdAt: Date.now() });
  
  res.cookie("adminToken", token, {
    httpOnly: true,
    maxAge: adminSessionTtlMs,
    sameSite: "strict"
  });
  
  res.json({ success: true });
});

// Admin Logout
app.post("/secadmin/logout", (req, res) => {
  const token = req.cookies.adminToken;
  if (token) {
    adminSessions.delete(token);
  }
  res.clearCookie("adminToken");
  res.json({ success: true });
});

// Admin Page (GET) - requires authentication
app.get("/secadmin", (req, res) => {
  if (!isAdminAuthenticated(req)) {
    return res.type("html").send(renderAdminLoginPage());
  }
  
  const whitelist = readWhitelist();
  res.type("html").send(renderAdminDashboard(whitelist));
});

// Admin API - Add/Update User
app.post("/secadmin/api/user", (req, res) => {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const nationalId = String(req.body?.nationalId || "").trim();
  const displayName = String(req.body?.displayName || "").trim();
  const localAdUser = String(req.body?.localAdUser || "").trim();
  const allowedReports = req.body?.allowedReports;
  
  if (!/^\d{10}$/.test(nationalId)) {
    return res.status(400).json({ error: "Invalid nationalId (must be 10 digits)" });
  }
  
  if (!localAdUser) {
    return res.status(400).json({ error: "localAdUser is required" });
  }
  
  const whitelist = readWhitelist();
  const existing = whitelist.whitelist.findIndex((item) => item.nationalId === nationalId);
  
  const user = {
    nationalId,
    displayName: displayName || "",
    localAdUser,
    allowedReports: Array.isArray(allowedReports) ? allowedReports : []
  };
  
  if (existing >= 0) {
    whitelist.whitelist[existing] = user;
  } else {
    whitelist.whitelist.push(user);
  }
  
  writeWhitelist(whitelist);
  res.json({ success: true, user });
});

// Admin API - Delete User
app.delete("/secadmin/api/user/:nationalId", (req, res) => {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const { nationalId } = req.params;
  const whitelist = readWhitelist();
  
  const index = whitelist.whitelist.findIndex((item) => item.nationalId === nationalId);
  if (index < 0) {
    return res.status(404).json({ error: "User not found" });
  }
  
  whitelist.whitelist.splice(index, 1);
  writeWhitelist(whitelist);
  
  res.json({ success: true });
});

// Clean up expired admin sessions periodically
setInterval(() => {
  for (const [token, session] of adminSessions.entries()) {
    if (Date.now() - session.createdAt > adminSessionTtlMs) {
      adminSessions.delete(token);
    }
  }
}, 5 * 60 * 1000);

const port = process.env.PORT || 8888;
app.listen(port, () => {
  console.log(`PBIRS Nafath integration API running on port ${port}`);
  console.log(`PBIRS Server: ${config.pbirs.apiBase}`);
  console.log(`Authentication: Windows Auth (NTLM)`);
});
