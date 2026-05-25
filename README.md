# Power BI + Nafath Integration (on-prem / service principal)

## Goal
- Whitelist national IDs and map to Azure user (RASED) accounts
- Use Azure AD app registration to acquire Power BI tokens
- Allow whitelisted citizens to request embed tokens for dashboards

## Prerequisites
1. Power BI tenant or on-prem workspace. Set workspace group ID in env var `POWERBI_GROUP_ID`.
2. Azure AD app registration with `clientId`, `tenantId`, and `clientSecret` (service principal).
3. API permissions for Power BI:
   - `Tenant.Read.All`, `Content.Create`, `Dataset.ReadWrite.All`, etc. (as needed)
   - Grant admin consent.
4. Install dependencies:
   ```bash
   npm install
   ```

## Configuration
- Either set environment variables, or edit `src/config.js`:
  - `AZURE_TENANT_ID` (default: `41f55948-9fbd-412b-9c58-710aa6c16972`)
  - `AZURE_CLIENT_ID` (default: `075b38cb-9cf4-41cd-b443-7692cfe41d22`)
  - `AZURE_CLIENT_SECRET` (default: `H3M8Q~JqmxHOuqrovcRAPcxC5BV5fyPdX7.kpdeA`)
  - `POWERBI_GROUP_ID`

## Whitelist JSON
- File: `whitelist.json`
- Format:
  ```json
  {
    "whitelist": [
      {
        "nationalId": "1234567890",
        "azureUser": "rased.user@yourtenant.onmicrosoft.com",
        "displayName": "RASED User",
        "allowedReports": ["<reportId1>", "<reportId2>"]
      }
    ]
  }
  ```

## Run
```bash
npm start
```

## API Endpoints
- `GET /health`
- `GET /whitelist`
- `POST /whitelist` (body: `nationalId`, `azureUser`, optional `displayName`, `allowedReports`)
- `GET /reports` (lists reports in workspace)
- `POST /access` (body: `nationalId`, `reportId`) -> generates embed token

## Flow
1. Citizen uses national ID.
2. Service checks `whitelist.json` to retrieve mapped Azure RASED user.
3. Service calls Power BI REST APIs (via service principal) to generate embed tokens.
4. Client renders dashboards in Power BI embedding UI.

## Important
- Safeguard `AZURE_CLIENT_SECRET`.
- For “on-prem” Power BI Report Server, endpoint and auth differ (not covered here). 
