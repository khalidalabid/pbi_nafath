const config = {
  pbirs: {
    // On-prem Power BI Report Server base URL (web portal root)
    apiBase: process.env.PBIRS_URL || "http://oci-p-mepbi/reports"
  },
  nafath: {
    sendUrl: process.env.NAFATH_SEND_URL || "https://wso2-gw-ext.mep.gov.sa/v1/nafath1/1.0.0/login-requests/send",
    statusUrl: process.env.NAFATH_STATUS_URL || "https://wso2-gw-ext.mep.gov.sa/v1/nafath2/1.0.0/check-status",
    apiKey: (process.env.NAFATH_API_KEY || "").trim(),
    acceptLanguage: process.env.NAFATH_ACCEPT_LANGUAGE || "Ar",
    service: process.env.NAFATH_SERVICE || "Login",
    clientId: (process.env.NAFATH_CLIENT_ID || "").trim(),
    defaultDashboardPath: process.env.DEFAULT_DASHBOARD_PATH || "/powerbi/RASED/RASED"
  },
  whitelistPath: "whitelist.json"
};

module.exports = config;