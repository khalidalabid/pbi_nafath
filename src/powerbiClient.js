const { execFile } = require("child_process");
const config = require("./config");

// Credentials MUST be set via environment variables — never hardcode them
if (!process.env.PBIRS_USERNAME || !process.env.PBIRS_PASSWORD) {
  throw new Error("PBIRS_USERNAME and PBIRS_PASSWORD must be set either in OS environment variables or in a project-root .env file");
}

function runPowerShell(script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        env: {
          ...process.env,
          ...extraEnv
        },
        maxBuffer: 1024 * 1024 * 10
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr?.trim() || stdout?.trim() || error.message;
          reject(new Error(message));
          return;
        }

        resolve(stdout);
      }
    );
  });
}

async function listReports() {
  try {
    const reportUrl = `${config.pbirs.apiBase}/api/v2.0/reports`;

    // Debug logging
    console.log(`[PBIRS] Attempting to fetch reports from: ${reportUrl}`);
    console.log(`[PBIRS] Using credentials for: ${process.env.PBIRS_USERNAME}`);

    const script = [
      '$secPassword = ConvertTo-SecureString $env:PBIRS_PASSWORD -AsPlainText -Force',
      '$cred = New-Object System.Management.Automation.PSCredential($env:PBIRS_USERNAME, $secPassword)',
      '$response = Invoke-WebRequest -Uri $env:PBIRS_REPORTS_URL -Credential $cred -UseBasicParsing',
      'Write-Output $response.Content'
    ].join('; ');

    const stdout = await runPowerShell(script, { PBIRS_REPORTS_URL: reportUrl });
    const data = JSON.parse(stdout);
    console.log(`[PBIRS] Successfully retrieved ${data.value?.length || 0} reports`);
    return data;
  } catch (err) {
    console.error(`[PBIRS] listReports() failed:`, err.message);
    throw new Error(`Failed to list PBIRS reports: ${err.message}`);
  }
}

function generateReportUrl(reportPath) {
  // PBIRS viewer URL: http://oci-p-mepbi/report/RASED/ReportName
  // reportPath should be like: /RASED/Bulk Download/Global BOP Detailed
  const cleanPath = reportPath.replace(/^\//, ""); // strip leading slash
  return appendEmbedQuery(`${config.pbirs.apiBase}/report/${cleanPath}`);
}

function appendEmbedQuery(url) {
  if (/[?&]rs:embed=true(?:&|$)/i.test(url)) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}rs:Embed=true`;
}

function generateDirectAccessUrl(reportPath, localAdUser) {
  // Direct PBIRS viewer URL — browser accesses with Windows SSO
  // reportPath should be like: /RASED/Bulk Download/Global BOP Detailed
  const cleanPath = reportPath.replace(/^\//, ""); // strip leading slash

  // Preserve PBIRS Power BI portal routes like /powerbi/RASED/RASED
  if (cleanPath.toLowerCase().startsWith("powerbi/")) {
    return appendEmbedQuery(`${config.pbirs.apiBase}/${cleanPath}`);
  }

  return appendEmbedQuery(`${config.pbirs.apiBase}/report/${cleanPath}`);
}

module.exports = {
  listReports,
  generateReportUrl,
  generateDirectAccessUrl
};
