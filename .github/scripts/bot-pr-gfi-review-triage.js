#!/usr/bin/env node
"use strict";
const fs = require("fs");
const https = require("https");
const path = require("path");

function exitWith(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

const GITHUB_EVENT_PATH = process.env.GITHUB_EVENT_PATH;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
if (!GITHUB_EVENT_PATH || !GITHUB_REPOSITORY) {
  exitWith("This script is intended to run inside GitHub Actions (needs GITHUB_EVENT_PATH and GITHUB_REPOSITORY).");
}

let event;
try {
  event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH, "utf8"));
} catch (e) {
  exitWith(`Failed to read or parse GITHUB_EVENT_PATH: ${e.message}`);
}

const PR_NUMBER = event && event.pull_request && event.pull_request.number;
if (!PR_NUMBER) {
  console.log("No pull_request.number found in event payload");
  process.exit(0);
}

const [OWNER, REPO] = GITHUB_REPOSITORY.split("/");
if (!OWNER || !REPO) {
  exitWith("GITHUB_REPOSITORY must be in owner/repo format");
}
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) exitWith("GITHUB_TOKEN not set");

const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase();
const isDryRun = !(DRY_RUN === "false" || DRY_RUN === "0" || DRY_RUN === "no");

const TRIAGE_FILE = path.join(process.cwd(), ".github", "triage-reviewers.txt");
let triageList = "";
if (fs.existsSync(TRIAGE_FILE)) {
  triageList = fs
    .readFileSync(TRIAGE_FILE, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join(" ");
} else {
  triageList = (process.env.TRIAGE_REVIEWERS || "").trim();
}

if (!triageList) exitWith("No triage reviewers configured. Provide .github/triage-reviewers.txt or TRIAGE_REVIEWERS env var.");

const mentions = triageList
  .replace(/,/g, " ")
  .split(/\s+/)
  .filter(Boolean)
  .map((name) => (name.startsWith("@") ? name : `@${name}`))
  .join(" ");
const MARKER = "<!-- triage-request -->";
const BODY_TEXT = `${MARKER}\nRequesting triage review from: ${mentions}`;

console.log(`PR #${PR_NUMBER} in ${OWNER}/${REPO} — triage mentions: ${mentions}`);

function apiRequest(method, pathUrl, data) {
  const options = {
    method,
    hostname: "api.github.com",
    path: pathUrl,
    headers: {
      "User-Agent": "hiero-sdk-bot",
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${TOKEN}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const parsed = body ? JSON.parse(body) : null;
          if (res.statusCode && res.statusCode >= 400) {
            const err = new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`);
            err.response = parsed || body;
            return reject(err);
          }
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    if (data) {
      const payload = JSON.stringify(data);
      req.setHeader("Content-Type", "application/json");
      req.setHeader("Content-Length", Buffer.byteLength(payload));
      req.write(payload);
    }
    req.end();
  });
}

(async () => {
  try {
    const commentsPath = `/repos/${OWNER}/${REPO}/issues/${PR_NUMBER}/comments`;
    const comments = await apiRequest("GET", commentsPath);
    if (Array.isArray(comments)) {
      if (comments.some((c) => typeof c.body === "string" && c.body.includes(MARKER))) {
        console.log("Triage comment already present; skipping.");
        process.exit(0);
      }
    }

    if (isDryRun) {
      console.log("DRY RUN: would post comment to PR #" + PR_NUMBER + " with body:\n---\n" + BODY_TEXT + "\n---");
      process.exit(0);
    }

    console.log("Posting triage request comment to PR #" + PR_NUMBER);
    const resp = await apiRequest("POST", commentsPath, { body: BODY_TEXT });
    const comment_id = resp && resp.id;
    if (comment_id) {
      console.log("Comment posted successfully (id: " + comment_id + ")");
    } else {
      console.log("Comment posted; response: " + JSON.stringify(resp));
    }
    process.exit(0);
  } catch (err) {
    console.error("Error:", err && err.message || err);
    if (err && err.response) console.error("Response:", JSON.stringify(err.response));
    process.exit(1);
  }
})();
