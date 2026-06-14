import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const pluginJsonPath = path.resolve('./plugin.json');

let version = process.argv[2];

if (!version) {
  console.error("Usage: npm run release <version>");
  console.error("Example: npm run release 1.2.0");
  process.exit(1);
}

if (version.startsWith('v')) {
  version = version.substring(1);
}

if (!/^[0-9]+\.[0-9]+\.[0-9]+(-.+)?$/.test(version)) {
  console.error(`Error: Version '${version}' is not a valid semantic version.`);
  process.exit(1);
}

const tag = `v${version}`;

try {
  // Ensure working directory is clean
  const status = execSync('git status --porcelain', { encoding: 'utf8' });
  if (status.trim() !== '') {
    console.error("Error: You have uncommitted changes. Please commit or stash them before releasing.");
    process.exit(1);
  }
} catch(e) {
  console.error("Error checking git status.");
  process.exit(1);
}

try {
  // 1. Update plugin.json to target version
  console.log(`Bumping plugin.json to ${version}...`);
  const pluginData = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
  pluginData.version = version;
  // Use tabs to match original formatting
  fs.writeFileSync(pluginJsonPath, JSON.stringify(pluginData, null, '\t') + '\n');

  // 2. Commit the target version
  console.log(`Committing release ${tag}...`);
  execSync('git add plugin.json', { stdio: 'inherit' });
  execSync(`git commit -m "chore: release ${tag}"`, { stdio: 'inherit' });

  // 3. Tag the commit
  console.log(`Tagging as ${tag}...`);
  execSync(`git tag ${tag}`, { stdio: 'inherit' });

  // 4. Update plugin.json back to dev version
  console.log(`Bumping plugin.json back to 0.0.0-dev...`);
  pluginData.version = '0.0.0-dev';
  fs.writeFileSync(pluginJsonPath, JSON.stringify(pluginData, null, '\t') + '\n');

  // 5. Commit the dev version
  console.log(`Committing dev version...`);
  execSync('git add plugin.json', { stdio: 'inherit' });
  execSync(`git commit -m "chore: prepare for next development iteration"`, { stdio: 'inherit' });

  console.log('\n✅ Success! The local release has been prepared and tagged.');
  console.log(`To publish to GitHub, run:\n\n  git push origin main --tags\n`);

} catch (e) {
  console.error('\n❌ Release failed!', e.message);
  process.exit(1);
}
