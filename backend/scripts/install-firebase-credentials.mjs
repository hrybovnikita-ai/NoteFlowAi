import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const downloads = path.join(os.homedir(), "Downloads");
const searchRoots = [
  downloads,
  path.join(downloads, "Telegram Desktop"),
  path.join(os.homedir(), "Desktop"),
  "D:/Завантаження",
  "D:/Downloads",
];
const targetDir = process.platform === "win32" ? "C:\\FirebaseSecrets" : path.join(os.homedir(), "FirebaseSecrets");
const targetFile = path.join(targetDir, "noteflowai-73991-service-account.json");
const expectedProjectId = "noteflowai-73991";

function isServiceAccount(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed?.type === "service_account"
      && typeof parsed.private_key === "string"
      && parsed.project_id === expectedProjectId;
  } catch {
    return false;
  }
}

function findCandidate(root) {
  if (!fs.existsSync(root)) return null;
  const preferredNames = [
    "noteflowai-73991-service-account.json",
    "noteflowai-73991-firebase-adminsdk-fbsvc-9a4c84efcd.json",
    "noteflowai-73991-firebase-adminsdk-fbsvc-d614b47bcf.json",
  ];
  for (const name of preferredNames) {
    const direct = path.join(root, name);
    if (fs.existsSync(direct) && isServiceAccount(direct)) return direct;
  }
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "mingw64"].includes(entry.name)) continue;
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        const lower = entry.name.toLowerCase();
        if (lower.includes("firebase-adminsdk") || lower.includes("noteflowai-73991")) {
          if (isServiceAccount(fullPath)) return fullPath;
        } else if (isServiceAccount(fullPath)) {
          return fullPath;
        }
      }
    }
  }
  return null;
}

fs.mkdirSync(targetDir, { recursive: true });
if (fs.existsSync(targetFile) && isServiceAccount(targetFile)) {
  console.log(`OK: Credentials already installed at ${targetFile}`);
  process.exit(0);
}

let candidate = null;
for (const root of searchRoots) {
  candidate = findCandidate(root);
  if (candidate) break;
}
if (!candidate) {
  console.error("Could not find a Firebase service account JSON for noteflowai-73991 in Downloads.");
  console.error("Expected a file like noteflowai-73991-firebase-adminsdk-*.json in Downloads.");
  console.error(`Place the downloaded key there, then run this script again. Target: ${targetFile}`);
  process.exit(1);
}

fs.copyFileSync(candidate, targetFile);
console.log(`Installed credentials to ${targetFile}`);
console.log(`Source copy kept at ${candidate} (remove it manually if you no longer need it).`);
