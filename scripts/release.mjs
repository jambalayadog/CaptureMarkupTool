// Builds the installer and publishes it as a GitHub release, which is where the
// installed app looks for updates. Bump "version" in package.json, commit and
// push first. Needs the GitHub CLI (gh), signed in.
//
//   npm run release                       release notes from the commit log
//   npm run release -- --notes "text"     your own notes
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts })
const fail = (msg) => {
  console.error(`release: ${msg}`)
  process.exit(1)
}

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = `v${version}`

if (run('git', ['status', '--porcelain']).trim()) fail('commit your changes first')
run('git', ['fetch', '--quiet', 'origin'])
if (run('git', ['rev-parse', 'HEAD']).trim() !== run('git', ['rev-parse', '@{u}']).trim()) fail('push main first')
try {
  run('gh', ['release', 'view', tag], { stdio: 'ignore' })
  fail(`${tag} is already released: bump "version" in package.json`)
} catch {
  // not released yet: good
}

// npm is a .cmd script on Windows, so it needs a shell (its arguments have no spaces)
run('npm', ['run', 'dist'], { stdio: 'inherit', shell: process.platform === 'win32' })

const exe = `dist/CaptureMarkupTool-Setup-${version}.exe`
// latest.yml tells installed copies what the newest version is; the blockmap lets them download only what changed
const files = [exe, `${exe}.blockmap`, 'dist/latest.yml']
for (const f of files) if (!existsSync(f)) fail(`missing ${f}`)

const i = process.argv.indexOf('--notes')
const notes = i > 0 ? ['--notes', process.argv[i + 1] ?? ''] : ['--generate-notes']
run('gh', ['release', 'create', tag, ...files, '--title', `Capture Markup Tool ${version}`, '--target', 'main', ...notes], {
  stdio: 'inherit'
})
console.log(`\nReleased ${tag}. Installed copies pick it up within a few hours, or from Help > Check for updates.`)
