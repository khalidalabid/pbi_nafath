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
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تسجيل الدخول الموحد</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary-green: #1B8354;
      --dark-green: #067647;
      --bg-light: #F3F4F6;
      --bg-page: #f8f9fa;
      --text-dark: #161616;
      --text-gray: #384250;
      --white: #ffffff;
      --border-color: #e5e7eb;
      --nafath-green: #2d7a4c;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'Tajawal', 'Segoe UI', Tahoma, sans-serif;
      background: var(--bg-page);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      color: var(--text-dark);
    }

    /* Header with Logo */
    .header {
      padding: 16px 32px;
      background: var(--white);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
    }

    .logo-container {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-container img {
      height: 50px;
      width: auto;
    }

    .lang-toggle {
      position: absolute;
      right: 32px;
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 8px 16px;
      cursor: pointer;
      font-family: inherit;
      font-size: 14px;
      color: var(--text-dark);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    html[dir="ltr"] .lang-toggle {
      right: 32px;
    }

    .lang-toggle:hover {
      background: var(--bg-light);
    }

    /* Main Content */
    .main-content {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 40px 24px;
    }

    .login-card {
      width: 100%;
      max-width: 480px;
      background: var(--white);
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
      overflow: hidden;
    }

    .card-header {
      padding: 32px 32px 24px;
      text-align: center;
      border-bottom: 1px solid var(--border-color);
    }

    .card-header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin-bottom: 8px;
      color: var(--text-dark);
    }

    .card-header p {
      color: var(--text-gray);
      font-size: 0.95rem;
    }

    .card-body {
      padding: 32px;
    }

    /* Nafath Section */
    .nafath-section {
      text-align: center;
    }

    .nafath-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #e8f5e9, #c8e6c9);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .nafath-icon svg {
      width: 40px;
      height: 40px;
      fill: var(--primary-green);
    }

    .nafath-description {
      color: var(--text-gray);
      font-size: 0.95rem;
      line-height: 1.7;
      margin-bottom: 24px;
    }

    .form-group {
      margin-bottom: 20px;
      text-align: right;
    }

    html[dir="ltr"] .form-group {
      text-align: left;
    }

    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-size: 0.95rem;
      font-weight: 500;
      color: var(--text-dark);
    }

    .form-group input {
      width: 100%;
      padding: 14px 16px;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      font-size: 1rem;
      font-family: inherit;
      transition: border-color 0.2s, box-shadow 0.2s;
      text-align: right;
      direction: ltr;
    }

    html[dir="ltr"] .form-group input {
      text-align: left;
    }

    .form-group input:focus {
      outline: none;
      border-color: var(--primary-green);
      box-shadow: 0 0 0 3px rgba(27, 131, 84, 0.1);
    }

    .nafath-btn {
      width: 100%;
      padding: 16px 24px;
      background: var(--nafath-green);
      color: var(--white);
      border: none;
      border-radius: 10px;
      font-size: 1rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: background 0.2s;
    }

    .nafath-btn:hover {
      background: var(--dark-green);
    }

    .nafath-btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    .nafath-btn svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
    }

    /* Status Card */
    .status-card {
      margin-top: 24px;
      padding: 20px;
      border-radius: 12px;
      border: 1px solid var(--border-color);
      background: var(--bg-light);
      display: none;
      text-align: center;
    }

    .status-card.visible {
      display: block;
      animation: fadeIn 0.3s ease;
    }

    .status-message {
      color: var(--text-dark);
      font-weight: 500;
      margin-bottom: 8px;
    }

    .status-detail {
      color: var(--text-gray);
      font-size: 0.9rem;
    }

    .random-box {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 100px;
      margin: 16px 0;
      padding: 16px 24px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--primary-green), var(--dark-green));
      color: var(--white);
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: 0.1em;
    }

    .status-error .status-message {
      color: #d32f2f;
    }

    .status-success .status-message {
      color: var(--primary-green);
    }

    /* Footer */
    .footer {
      background: var(--bg-light);
      border-top: 1px solid var(--border-color);
      padding: 20px 32px;
    }

    .footer-content {
      max-width: 1200px;
      margin: 0 auto;
    }

    .footer-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }

    .gov-badge {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .gov-badge svg {
      width: 24px;
      height: 24px;
      fill: var(--primary-green);
    }

    .gov-badge span {
      font-size: 0.9rem;
      color: var(--text-dark);
    }

    .verify-link {
      color: var(--primary-green);
      font-size: 0.9rem;
      text-decoration: none;
      cursor: pointer;
    }

    .verify-link:hover {
      text-decoration: underline;
    }

    .dga-registration {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 20px;
      background: var(--white);
      border-radius: 8px;
    }

    .dga-registration svg {
      width: 32px;
      height: 32px;
    }

    .dga-registration .dga-text {
      font-size: 0.85rem;
      color: var(--text-gray);
    }

    .dga-registration .dga-number {
      font-weight: 700;
      color: var(--primary-green);
      font-size: 0.95rem;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 600px) {
      .header {
        padding: 12px 16px;
      }
      .lang-toggle {
        position: static;
        margin-left: auto;
      }
      html[dir="ltr"] .lang-toggle {
        margin-left: 0;
        margin-right: auto;
      }
      .main-content {
        padding: 24px 16px;
      }
      .card-header, .card-body {
        padding: 24px 20px;
      }
      .footer {
        padding: 16px;
      }
      .footer-row {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  </style>
</head>
<body>
  <!-- Header with MEP Logo -->
  <header class="header">
    <div class="logo-container">
      <img src="../logo-mep.jpg" alt="Ministry of Economy and Planning Logo">
    </div>
    <button class="lang-toggle" onclick="toggleLanguage()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>
      <span id="langText">English</span>
    </button>
  </header>

  <!-- Main Content -->
  <main class="main-content">
    <div class="login-card">
      <div class="card-header">
        <h1 id="titleText">تسجيل الدخول</h1>
        <p id="subtitleText">الدخول عبر النفاذ الوطني الموحد</p>
      </div>
      <div class="card-body">
        <div class="nafath-section">
          <div class="nafath-icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          </div>
          <p class="nafath-description" id="descriptionText">
            سيتم توجيهك إلى تطبيق نفاذ الوطني للتحقق من الهوية بشكل آمن وسريع عبر الهوية الوطنية أو الإقامة.
          </p>
          <form id="loginForm">
            <div class="form-group">
              <label for="nationalId" id="labelText">رقم الهوية الوطنية / الإقامة</label>
              <input id="nationalId" name="nationalId" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="" required>
            </div>
            <button id="submitBtn" type="submit" class="nafath-btn">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <span id="btnText">الدخول عبر نفاذ</span>
            </button>
          </form>

          <section id="statusCard" class="status-card" aria-live="polite">
            <p id="message" class="status-message"></p>
            <div id="randomBox" class="random-box" hidden>--</div>
            <p id="subMessage" class="status-detail"></p>
          </section>
        </div>
      </div>
    </div>
  </main>

  <!-- Footer with DGA Registration -->
  <footer class="footer">
    <div class="footer-content">
      <div class="footer-row">
        <div class="gov-badge">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <span id="govText">موقع حكومي رسمي تابع لحكومة المملكة العربية السعودية</span>
        </div>
        <div class="dga-registration">
          <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="4" width="40" height="40" rx="4" fill="#067647"/>
            <path d="M24 12v24M12 24h24" stroke="white" stroke-width="3" stroke-linecap="round"/>
          </svg>
          <div>
            <div class="dga-text" id="dgaText">Registered with the Digital Government Authority under number :</div>
            <div class="dga-number">20260506590</div>
          </div>
        </div>
      </div>
    </div>
  </footer>

  <script>
    let isArabic = true;

    const translations = {
      ar: {
        lang: "English",
        title: "تسجيل الدخول",
        subtitle: "الدخول عبر النفاذ الوطني الموحد",
        description: "سيتم توجيهك إلى تطبيق نفاذ الوطني للتحقق من الهوية بشكل آمن وسريع عبر الهوية الوطنية أو الإقامة.",
        label: "رقم الهوية الوطنية / الإقامة",
        btn: "الدخول عبر نفاذ",
        gov: "موقع حكومي رسمي تابع لحكو���� المملكة العربية السعودية",
        dga: "مسجل لدى هيئة الحكومة الرقمية برقم:",
        sending: "جاري إرسال الطلب إلى نفاذ...",
        wait: "يرجى الانتظار...",
        openNafath: "افتح تطبيق نفاذ على جهازك.",
        selectOtp: "اختر الرقم المطابق للرقم المعروض أدناه.",
        waiting: "في انتظار الموافقة من نفاذ...",
        waitingDetail: "اختر الرقم المطابق في تطبيق نفاذ للمتابعة.",
        success: "تم التحقق بنجاح.",
        redirecting: "جاري التوجيه إلى لوحة التحكم...",
        rejected: "لم تتم الموافقة على الطلب.",
        rejectedDetail: "تم رفض الطلب أو انتهت صلاحيته.",
        error: "تعذر بدء التحقق من نفاذ.",
        statusError: "تعذر التحقق من حالة الطلب."
      },
      en: {
        lang: "العربية",
        title: "Login",
        subtitle: "Login via National Single Sign-On",
        description: "You will be redirected to the Nafath app for secure and fast identity verification using your National ID or Iqama.",
        label: "National ID / Iqama Number",
        btn: "Login via Nafath",
        gov: "Official government website of the Government of the Kingdom of Saudi Arabia",
        dga: "Registered with the Digital Government Authority under number:",
        sending: "Sending request to Nafath...",
        wait: "Please wait...",
        openNafath: "Open Nafath app on your device.",
        selectOtp: "Select the OTP that matches the number shown below.",
        waiting: "Waiting for Nafath approval...",
        waitingDetail: "Choose the matching number in the Nafath app to continue.",
        success: "Verification completed.",
        redirecting: "Redirecting to your dashboard...",
        rejected: "Verification was not approved.",
        rejectedDetail: "The request was rejected or expired.",
        error: "Unable to start Nafath verification.",
        statusError: "Unable to verify the Nafath request."
      }
    };

    function toggleLanguage() {
      isArabic = !isArabic;
      const lang = isArabic ? 'ar' : 'en';
      const t = translations[lang];
      
      document.documentElement.lang = lang;
      document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
      
      document.getElementById('langText').textContent = t.lang;
      document.getElementById('titleText').textContent = t.title;
      document.getElementById('subtitleText').textContent = t.subtitle;
      document.getElementById('descriptionText').textContent = t.description;
      document.getElementById('labelText').textContent = t.label;
      document.getElementById('btnText').textContent = t.btn;
      document.getElementById('govText').textContent = t.gov;
      document.getElementById('dgaText').textContent = t.dga;
    }

    function getTranslation(key) {
      const lang = isArabic ? 'ar' : 'en';
      return translations[lang][key] || key;
    }

    const form = document.getElementById("loginForm");
    const submitBtn = document.getElementById("submitBtn");
    const statusCard = document.getElementById("statusCard");
    const message = document.getElementById("message");
    const subMessage = document.getElementById("subMessage");
    const randomBox = document.getElementById("randomBox");
    let pollTimer = null;

    function showStatus(text, detail, variant, randomValue) {
      statusCard.classList.add("visible");
      statusCard.className = "status-card visible" + (variant === "error" ? " status-error" : variant === "success" ? " status-success" : "");
      message.textContent = text;
      message.className = "status-message";
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
        showStatus(getTranslation('success'), getTranslation('redirecting'), "success", data.random);
        window.location.assign(data.redirectUrl);
        return;
      }

      if (data.state === "rejected") {
        stopPolling();
        showStatus(getTranslation('rejected'), data.message || getTranslation('rejectedDetail'), "error", data.random);
        submitBtn.disabled = false;
        return;
      }

      showStatus(getTranslation('waiting'), data.message || getTranslation('waitingDetail'), "", data.random);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      stopPolling();

      const nationalId = document.getElementById("nationalId").value.trim();
      submitBtn.disabled = true;
      showStatus(getTranslation('sending'), getTranslation('wait'), "");

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
          getTranslation('openNafath'),
          getTranslation('selectOtp'),
          "",
          data.random
        );

        pollTimer = setInterval(() => {
          checkStatus(data.transactionId).catch((error) => {
            stopPolling();
            submitBtn.disabled = false;
            showStatus(getTranslation('statusError'), error.message, "error", data.random);
          });
        }, 3000);

        checkStatus(data.transactionId).catch((error) => {
          stopPolling();
          submitBtn.disabled = false;
          showStatus(getTranslation('statusError'), error.message, "error", data.random);
        });
      } catch (error) {
        submitBtn.disabled = false;
        showStatus(getTranslation('error'), error.message, "error");
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
