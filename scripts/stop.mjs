/*
 * Stops whatever is listening on the dev port.
 *
 *   npm run stop           -> kills the server on the configured port
 *   npm run dev            -> runs this first, so a stale server never blocks the start
 *
 * The port is package.json "config".port, overridable with PORT, same as vite.config.ts.
 */
import { execFileSync } from 'node:child_process'

const PORT = Number(process.env.PORT || process.env.npm_package_config_port) || 5180
const quiet = process.argv.includes('--quiet')

const say = (msg) => {
  if (!quiet) console.log(msg)
}

/* A listening socket is the one with no peer. Matching on that instead of the word
 * "LISTENING" keeps this working on a non-English Windows, where netstat translates it. */
const NO_PEER = new Set(['0.0.0.0:0', '[::]:0', '*:*'])

/** PIDs listening on PORT, or [] when nothing is. */
function listeners() {
  try {
    if (process.platform === 'win32') {
      // No -p tcp: that filter hides IPv6 rows, and vite listens on [::1].
      const out = execFileSync('netstat', ['-a', '-n', '-o'], { encoding: 'utf8' })
      const pids = out
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter(([proto, local, peer, , pid]) =>
          proto === 'TCP' && local?.endsWith(`:${PORT}`) && NO_PEER.has(peer) && pid,
        )
        .map((cols) => cols[4])
      return [...new Set(pids)].filter((pid) => pid !== '0')
    }
    const out = execFileSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return [] // netstat/lsof missing, or no match: treat the port as free
  }
}

/* `npm run dev` is npm -> node -> vite. Killing only the listener (vite) leaves the npm
 * wrapper behind as a stray node process, so walk up to the topmost node ancestor and
 * kill from there. The walk stops at the first non-node parent, which is the shell — so
 * it can never climb out into the terminal or into another project's processes. */
function topNodeAncestor(pid) {
  if (process.platform !== 'win32') return pid
  let procs
  try {
    const json = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
    procs = new Map(JSON.parse(json).map((p) => [String(p.ProcessId), p]))
  } catch {
    return pid // no process table: settle for the listener itself
  }

  let top = String(pid)
  for (let hop = 0; hop < 12; hop++) {
    const parent = procs.get(String(procs.get(top)?.ParentProcessId))
    if (!parent || !/^node(\.exe)?$/i.test(parent.Name)) break
    top = String(parent.ProcessId)
  }
  return top
}

const pids = listeners()

if (!pids.length) {
  say(`  nothing running on port ${PORT}`)
  process.exit(0)
}

for (const pid of pids) {
  const target = topNodeAncestor(pid)
  try {
    // /T takes the whole tree below the target: npm, vite, and anything they spawned.
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', target, '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(Number(target), 'SIGTERM')
    }
    const extra = target === String(pid) ? '' : ` (and its npm parent ${target})`
    say(`  stopped pid ${pid}${extra} on port ${PORT}`)
  } catch (err) {
    console.error(`  could not stop pid ${pid}: ${err.message}`)
    process.exitCode = 1
  }
}
