// Ports a device PR written against the old ha_bridge.ts tables to the driver registry
// (cloud/registry.ts): the PR's table entries and README rows become `models` entries in its driver
// files.
//
// From the PR branch, with this repo's master fetched (here as `upstream/master`):
//
//   npx tsx tools/port-to-registry.ts --rebase upstream/master
//
// rebases the branch, resolving conflicts in cloud/ha_bridge.ts and README.md by taking master's
// version (the PR's entries are re-created from the pre-rebase branch), then ports. Other conflicts
// stop the rebase: resolve them, finish the rebase, and run the port step on its own, naming the
// pre-rebase branch tip (printed at the start, also in ORIG_HEAD or the reflog):
//
//   npx tsx tools/port-to-registry.ts <old-branch-tip>
//
// The script edits the working tree only. Review `git diff`, then commit (usually `--amend`).
//
// The tool is meant to run from a checkout of master that has the registry, so `git show` reads the
// PR's old files, not the working tree.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

type Platform = 'thinq1' | 'thinq2'
type Registration = { ident: string; comment?: string }
type Row = { category: string; ids: string[]; platform: Platform; appliance: string; support: string }
type NewEntry = Row & { comments: (string | undefined)[]; driver?: string }
type Import = { module: string; name: string } // name: the module's export, 'default' or named

const HOTSPOTS = ['cloud/ha_bridge.ts', 'README.md']
const warnings: string[] = []
const edited = new Set<string>()

function git(...args: string[]) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function show(ref: string, file: string) {
    try {
        return git('show', `${ref}:${file}`)
    } catch {
        return ''
    }
}

// --- the old formats ---------------------------------------------------------------------------

function parseBridge(src: string) {
    const imports = new Map<string, Import>()
    for (const m of src.matchAll(/^import (\w+) from '\.\/devices\/([^']+)'/gm))
        imports.set(m[1], { module: m[2], name: 'default' })
    for (const m of src.matchAll(/^import \{([^}]*)\} from '\.\/devices\/([^']+)'/gm)) {
        for (const spec of m[1].split(',')) {
            const [name, local] = spec.trim().split(/\s+as\s+/)
            if (name) imports.set(local ?? name, { module: m[2], name })
        }
    }

    const tables: Record<Platform, Map<string, Registration>> = { thinq1: new Map(), thinq2: new Map() }
    for (const m of src.matchAll(/const t(\d)deviceTypes[^{]*\{([\s\S]*?)\n\}/g)) {
        const table = tables[`thinq${m[1]}` as Platform]
        for (const line of m[2].split('\n')) {
            const e = line.match(/^\s+'?([\w.]+)'?(?::\s*(\w+))?,\s*(?:\/\/\s*(.*))?$/)
            if (e) table.set(e[1], { ident: e[2] ?? e[1], comment: e[3] })
        }
    }

    // everything else, to notice PRs that changed ha_bridge.ts beyond registering devices
    const rest = src
        .replace(/^import (\w+|\{[^}]*\}) from '\.\/devices\/[^']+'\n/gm, '')
        .replace(/const t\ddeviceTypes[^{]*\{[\s\S]*?\n\}/g, '')
    return { imports, tables, rest }
}

function parseReadme(src: string) {
    const rows = new Map<string, Row>() // `${platform}:${id}` -> row
    let category = ''
    for (const line of src.split('\n')) {
        if (line.startsWith('#### ')) category = line.slice(5).trim()
        if (!line.startsWith('|') || /^\|\s*(-|ThinQ model)/.test(line)) continue
        const cells = line
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim())
        if (cells.length !== 3) continue
        let ids = cells[0].replace(/\\(.)/g, '$1')
        let platform: Platform = 'thinq2'
        if (ids.endsWith('(ThinQ1)')) {
            platform = 'thinq1'
            ids = ids.slice(0, -'(ThinQ1)'.length).trim()
        }
        const row: Row = {
            category,
            ids: ids.split(',').map((s) => s.trim()),
            platform,
            appliance: cells[1].replace(/\\(.)/g, '$1'),
            support: cells[2].replace(/\\(.)/g, '$1'),
        }
        for (const id of row.ids) rows.set(`${platform}:${id}`, row)
    }
    return rows
}

// --- editing driver files ----------------------------------------------------------------------

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const driverFile = (module: string) => path.join('cloud/devices', `${module}.ts`)

function renderEntry(e: NewEntry) {
    const lines: string[] = []
    let comments = e.comments
    if (e.ids.length === 1 && comments[0]) {
        lines.push(`    // ${comments[0]}`)
        comments = [undefined]
    }
    lines.push('    {')
    if (e.platform !== 'thinq2') lines.push(`        platform: ${q(e.platform)},`)
    lines.push(`        category: ${q(e.category)},`)
    if (comments.some(Boolean)) {
        lines.push('        ids: [')
        e.ids.forEach((id, i) => lines.push(`            ${q(id)},` + (comments[i] ? ` // ${comments[i]}` : '')))
        lines.push('        ],')
    } else lines.push(`        ids: [${e.ids.map(q).join(', ')}],`)
    if (e.driver) lines.push(`        driver: ${q(e.driver)},`)
    lines.push(`        appliance: ${q(e.appliance)},`, `        support: ${q(e.support)},`, '    },')
    return lines.join('\n')
}

function addEntries(module: string, entries: NewEntry[]) {
    const file = driverFile(module)
    if (!fs.existsSync(file)) {
        warnings.push(`${file} does not exist; add its models by hand:\n${entries.map(renderEntry).join('\n')}`)
        return
    }
    let src = fs.readFileSync(file, 'utf8')
    const body = entries.map(renderEntry).join('\n')
    const decl = src.indexOf('export const models')
    if (decl >= 0) {
        const close = src.indexOf('\n]', decl)
        src = src.slice(0, close) + '\n' + body + src.slice(close)
    } else {
        const imports = [...src.matchAll(/^import [\s\S]*?from '[^']+'\n/gm)]
        const at = imports.length ? imports[imports.length - 1].index! + imports[imports.length - 1][0].length : 0
        src = src.slice(0, at) + "import { type ModelEntry } from '../registry'\n" + src.slice(at)
        src = src.trimEnd() + '\n\nexport const models: ModelEntry[] = [\n' + body + '\n]\n'
    }
    fs.writeFileSync(file, src)
    edited.add(file)
}

// Finds the `models` entry that lists `id`, in any driver
function findEntry(id: string) {
    for (const f of fs.readdirSync('cloud/devices')) {
        const file = path.join('cloud/devices', f)
        const src = fs.readFileSync(file, 'utf8')
        const decl = src.indexOf('export const models')
        if (decl < 0) continue
        const at = src.indexOf(q(id), decl)
        if (at < 0) continue
        return { file, src, start: src.lastIndexOf('{', at), end: src.indexOf('}', at) }
    }
    return undefined
}

function addIdsToEntry(existing: string, ids: string[], comments: (string | undefined)[]) {
    const e = findEntry(existing)
    if (!e) return false
    const entry = e.src.slice(e.start, e.end)
    const close = entry.indexOf(']', entry.indexOf('ids:'))
    const added = ids.map((id, i) => `\n${q(id)},` + (comments[i] ? ` // ${comments[i]}` : '')).join('')
    const head = entry.slice(0, close).replace(/,?\s*$/, ',')
    fs.writeFileSync(e.file, e.src.slice(0, e.start) + head + added + '\n' + entry.slice(close) + e.src.slice(e.end))
    edited.add(e.file)
    return true
}

function setEntryField(id: string, field: 'appliance' | 'support' | 'category', value: string) {
    const e = findEntry(id)
    if (!e) return false
    const entry = e.src
        .slice(e.start, e.end)
        .replace(new RegExp(`${field}:\\s*('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`), `${field}: ${q(value)}`)
    fs.writeFileSync(e.file, e.src.slice(0, e.start) + entry + e.src.slice(e.end))
    edited.add(e.file)
    return true
}

// --- the port ----------------------------------------------------------------------------------

function port(from: string) {
    const base = git('merge-base', from, 'HEAD')
    const oldBridge = parseBridge(show(base, 'cloud/ha_bridge.ts'))
    const prBridge = parseBridge(show(from, 'cloud/ha_bridge.ts'))
    const oldRows = parseReadme(show(base, 'README.md'))
    const prRows = parseReadme(show(from, 'README.md'))
    if (!prBridge.tables.thinq2.size) throw new Error(`${from} has no ha_bridge.ts device tables to port from`)

    if (prBridge.rest !== oldBridge.rest)
        warnings.push(
            'The PR also changes cloud/ha_bridge.ts outside the device tables. Check that the rebase kept those changes.',
        )

    // new registrations, grouped by README row
    type Group = { module: string; driver?: string; ids: string[]; comments: (string | undefined)[] }
    const groups = new Map<Row | string, Group>()
    for (const platform of ['thinq1', 'thinq2'] as Platform[]) {
        for (const [id, reg] of prBridge.tables[platform]) {
            const old = oldBridge.tables[platform].get(id)
            if (old) {
                if (old.ident !== reg.ident)
                    warnings.push(`${platform} ${id}: the PR moves it from ${old.ident} to ${reg.ident}; port by hand`)
                continue
            }
            const imp = prBridge.imports.get(reg.ident)
            if (!imp) {
                warnings.push(`${platform} ${id}: can't tell which module ${reg.ident} is; port by hand`)
                continue
            }
            const row = prRows.get(`${platform}:${id}`)
            const key = row ?? `${platform}:${id}`
            const driver = imp.name === 'default' ? undefined : imp.name
            const g = groups.get(key) ?? { module: imp.module, driver, ids: [], comments: [] }
            g.ids.push(id)
            g.comments.push(reg.comment)
            groups.set(key, g)
        }
    }

    const newEntries = new Map<string, NewEntry[]>()
    for (const [key, g] of groups) {
        if (typeof key === 'string') {
            const platform = key.split(':')[0] as Platform
            warnings.push(`${key} has no README row in the PR; fill in its category, appliance and support`)
            const entry = { platform, category: 'TODO', ids: g.ids, appliance: 'TODO', support: 'TODO' }
            const e = { ...entry, driver: g.driver, comments: g.comments }
            newEntries.set(g.module, [...(newEntries.get(g.module) ?? []), e])
            continue
        }
        // a row that also lists models registered before the PR extends that entry
        const existing = key.ids.find((id) => oldBridge.tables[key.platform].has(id))
        if (existing && addIdsToEntry(existing, g.ids, g.comments)) {
            setEntryField(existing, 'appliance', key.appliance)
            setEntryField(existing, 'support', key.support)
            console.log(`added ${g.ids.join(', ')} to the entry for ${existing}`)
            continue
        }
        const entry = { ...key, ids: g.ids, driver: g.driver, comments: g.comments }
        newEntries.set(g.module, [...(newEntries.get(g.module) ?? []), entry])
    }
    addCategories(new Set([...newEntries.values()].flat().map((e) => e.category)))
    const registered = new Set([...groups.values()].map((g) => g.module))
    const added = git('diff', '--name-only', '--diff-filter=A', base, from, '--', 'cloud/devices/')
        .split('\n')
        .filter((f) => f.endsWith('.ts'))
        .map((f) => path.basename(f, '.ts'))
    addSharedModules(added.filter((m) => !registered.has(m)))
    for (const [module, entries] of newEntries) {
        addEntries(module, entries)
        console.log(`${driverFile(module)}: ${entries.map((e) => e.ids.join(', ')).join('; ')}`)
    }

    // README edits to rows of models registered before the PR
    const done = new Set<Row>()
    for (const [key, row] of prRows) {
        const old = oldRows.get(key)
        const [platform, id] = key.split(':') as [Platform, string]
        if (!old || done.has(row) || !oldBridge.tables[platform].has(id)) continue
        done.add(row)
        for (const field of ['category', 'appliance', 'support'] as const) {
            if (row[field] !== old[field] && setEntryField(id, field, row[field]))
                console.log(`${id}: ${field} -> ${row[field]}`)
        }
    }
}

// A module the PR adds to cloud/devices/ without registering it is shared code
function addSharedModules(modules: string[]) {
    const file = 'cloud/registry.ts'
    let src = fs.readFileSync(file, 'utf8')
    const decl = src.indexOf('export const SHARED_MODULES')
    for (const module of modules) {
        const close = src.indexOf('])', decl)
        if (src.slice(decl, close).includes(q(module))) continue
        src = src.slice(0, close) + `    ${q(module)},\n` + src.slice(close)
        console.log(`${file}: ${module} is shared code (not a driver)`)
        edited.add(file)
    }
    fs.writeFileSync(file, src)
}

// A README heading the PR introduced becomes a new category
function addCategories(categories: Set<string>) {
    const file = 'cloud/registry.ts'
    let src = fs.readFileSync(file, 'utf8')
    const decl = src.indexOf('export const CATEGORIES')
    for (const category of categories) {
        const close = src.indexOf('] as const', decl)
        if (category === 'TODO' || src.slice(decl, close).includes(q(category))) continue
        src = src.slice(0, close) + `    ${q(category)},\n` + src.slice(close)
        console.log(`${file}: new category ${category}`)
        edited.add(file)
    }
    fs.writeFileSync(file, src)
}

async function finish() {
    if (/deviceTypes/.test(fs.readFileSync('cloud/ha_bridge.ts', 'utf8')))
        warnings.push("cloud/ha_bridge.ts still has device tables from the PR; take master's version of it")

    try {
        const prettier = await import('prettier')
        for (const file of edited) {
            const options = await prettier.resolveConfig(file)
            fs.writeFileSync(file, await prettier.format(fs.readFileSync(file, 'utf8'), { ...options, filepath: file }))
        }
    } catch (e) {
        warnings.push(`prettier failed (${e}); run \`npm run format\``)
    }

    const list = spawnSync('npx', ['tsx', 'tools/device-list.ts'], { stdio: 'inherit' })
    if (list.status !== 0) warnings.push('`npm run device-list` failed; fix the entries above and rerun it')

    for (const w of warnings) console.warn(`\nWARNING: ${w}`)
    console.log('\nReview `git diff`, run `npm test`, then commit (usually `git commit -a --amend`).')
}

function rebase(onto: string) {
    if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('commit or stash your changes first')
    const from = git('rev-parse', 'HEAD')
    console.log(`branch tip before the rebase: ${from}`)

    let r = spawnSync('git', ['rebase', onto], { stdio: 'inherit' })
    while (r.status !== 0) {
        const conflicts = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean)
        const other = conflicts.filter((f) => !HOTSPOTS.includes(f))
        if (!conflicts.length || other.length) {
            console.error(
                `\nResolve the conflicts in ${other.join(', ') || 'the files above'}, finish the rebase, then run:\n` +
                    `  npx tsx tools/port-to-registry.ts ${from}`,
            )
            process.exit(1)
        }
        // during a rebase, "ours" is the branch being rebased onto
        git('checkout', '--ours', '--', ...conflicts)
        git('add', '--', ...conflicts)
        const empty = spawnSync('git', ['diff', '--cached', '--quiet']).status === 0
        r = spawnSync('git', ['rebase', empty ? '--skip' : '--continue'], {
            stdio: 'inherit',
            env: { ...process.env, GIT_EDITOR: 'true' },
        })
    }
    return from
}

const args = process.argv.slice(2)
const at = args.indexOf('--rebase')
let from: string
if (at >= 0) {
    if (!args[at + 1]) throw new Error('usage: port-to-registry.ts --rebase <onto>')
    from = rebase(args[at + 1])
} else {
    if (!args[0]) throw new Error('usage: port-to-registry.ts <old-branch-tip> | --rebase <onto>')
    from = git('rev-parse', args[0])
}
port(from)
await finish()
