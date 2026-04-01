/**
 * This script automatically requests triage reviews on PRs labeled as "Good First Issue" or "Beginner".
 * It runs on when a pr added with label "Good First Issue" or "Beginner" and posts a comment mentioing triage reviewers.
 * 
 * safty measures:
 * - Only runs on PRs (not issues).
 * - Only run for once per pr.
 * - it does not run on new commit push but can run on pr label update 
 */


const fs = require("fs");
const https = require("https");

function fail(message) {
  console.error(`${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`${message}`);
}


const eventPath = process.env.GITHUB_EVENT_PATH;
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

if (!eventPath) fail("GITHUB_EVENT_PATH is not set.");
if (!repository) fail("GITHUB_REPOSITORY is not set.");
if (!token) fail("GITHUB_TOKEN is not set.");


let event;

try {
  const payload = fs.readFileSync(eventPath, "utf8");
  event = JSON.parse(payload);
} catch (err) {
  fail(`Failed to read GitHub event payload: ${err.message}`);
}

const prNumber = event?.pull_request?.number;

if (!prNumber) {
  info("No pull request found in event payload. Exiting.");
  process.exit(0);
}


const [owner, repo] = repository.split("/");

if (!owner || !repo) {
  fail("Invalid GITHUB_REPOSITORY format. Expected owner/repo.");
}


const commentBody =
  "Requesting triage review from: @hiero-ledger/hiero-sdk-python-triage";

info(`Preparing to comment on PR #${prNumber} in ${owner}/${repo}`);


const data = JSON.stringify({ body: commentBody });

const options = {
  hostname: "api.github.com",
  path: `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
  method: "POST",
  headers: {
    "User-Agent": "triage-review-bot",
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  },
};

const req = https.request(options, (res) => {
  let body = "";

  res.on("data", (chunk) => {
    body += chunk;
  });

  res.on("end", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      info("Comment posted successfully.");
    } else {
      console.error(`Error: GitHub API error (${res.statusCode})`);
      console.error(body);
      process.exit(1);
    }
  });
});

req.on("error", (err) => {
  fail(`Request failed: ${err.message}`);
});

req.write(data);
req.end();