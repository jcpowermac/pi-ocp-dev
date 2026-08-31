import https from "node:https";

export interface JiraClientOptions {
  apiToken?: string;
  username?: string;
  bearerToken?: string;
  baseUrl?: string;
  fetchFn?: (url: string, headers: Record<string, string>) => Promise<any>;
}

export function getJiraAuthHeaders(options?: {
  apiToken?: string;
  username?: string;
  bearerToken?: string;
}): Record<string, string> {
  const token = options?.apiToken || process.env.JIRA_API_TOKEN;
  const username = options?.username || process.env.JIRA_USERNAME;
  const bearer = options?.bearerToken || process.env.JIRA_BEARER_TOKEN;

  if (bearer) {
    return {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  if (token && username) {
    const creds = Buffer.from(`${username}:${token}`).toString("base64");
    return {
      Authorization: `Basic ${creds}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  throw new Error(
    "Jira credentials not found. Please set JIRA_API_TOKEN and JIRA_USERNAME or JIRA_BEARER_TOKEN environment variables.",
  );
}

function defaultHttpsFetch(url: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request(
      parsedUrl,
      {
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (err) {
              reject(new Error(`Failed to parse Jira response as JSON: ${err}`));
            }
          } else {
            reject(
              new Error(`Jira API request failed with HTTP ${res.statusCode}: ${body.slice(0, 300)}`),
            );
          }
        });
      },
    );

    req.on("error", (err) => reject(new Error(`Jira API network error: ${err.message}`)));
    req.end();
  });
}

export async function fetchJiraIssue(
  issueKey: string,
  baseUrl?: string,
  options?: JiraClientOptions,
): Promise<any> {
  const cleanKey = issueKey.trim().toUpperCase();
  const rootUrl =
    baseUrl ||
    options?.baseUrl ||
    process.env.JIRA_BASE_URL ||
    "https://redhat.atlassian.net";

  const headers = getJiraAuthHeaders(options);
  const endpoint = `${rootUrl.replace(/\/+$/, "")}/rest/api/3/issue/${cleanKey}?expand=renderedFields,names`;

  const fetcher = options?.fetchFn || defaultHttpsFetch;
  return fetcher(endpoint, headers);
}
