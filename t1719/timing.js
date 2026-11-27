// T1719 timings. usage: node timing.js <worktree> <base|exp> <reps> [scenario,...]
// Each rebuild toggles one marked line after an anchor, runs `cargo test --no-run --timings`, and
// reads the per-unit durations from cargo's timing report.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [wt, kind, repsArg, only] = process.argv.slice(2);
const reps = Number(repsArg || 3);
const npcDir = kind === 'exp' ? 'crates/csp-npc/src' : 'crates/csp-sim/src';
const pkgs = kind === 'exp' ? ['-p', 'csp-sim', '-p', 'csp-npc'] : ['-p', 'csp-sim'];
const MARK = '    std::hint::black_box(0u8); // T1719 timing';

const scenarios = {
  leaf: ['crates/csp-sim/src/zeal.rs', 'pub fn step_zeal(world: &mut WorldState) {'],
  queries: [
    'crates/csp-sim/src/queries/city.rs',
    'pub fn in_city_area(world: &WorldState, city_id: &str, x: i32, y: i32, size: i32) -> bool {',
  ],
  src_test: [
    'crates/csp-sim/src/zeal/tests.rs',
    'fn a_new_player_starts_full_and_a_full_pool_keeps_no_entry() {',
  ],
  tests_dir: [
    'crates/csp-sim/tests/work.rs',
    'fn sets_a_resident_to_work_the_farm_they_stand_on_as_plain_data() {',
  ],
  npc: [`${npcDir}/npc_plan.rs`, 'pub fn plan_due(world: &WorldState, city_id: &str) -> bool {'],
  npc_test: [
    `${npcDir}/npc_plan/tests.rs`,
    'fn sends_a_new_scout_only_with_the_food_they_take_above_the_reserve() {',
  ],
};

function toggle(file, anchor) {
  const p = path.join(wt, file);
  const text = fs.readFileSync(p, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  const i = lines.findIndex((l) => l === anchor);
  if (i < 0) throw new Error(`anchor not found in ${file}`);
  if (lines[i + 1] === MARK) lines.splice(i + 1, 1);
  else lines.splice(i + 1, 0, MARK);
  fs.writeFileSync(p, lines.join(eol));
}

function clean() {
  // Leaves the edits out of the tree when done: removes any marked line.
  for (const [file] of Object.values(scenarios)) {
    const p = path.join(wt, file);
    const text = fs.readFileSync(p, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    fs.writeFileSync(p, text.split(eol).filter((l) => l !== MARK).join(eol));
  }
}

function latestTimings() {
  const dir = path.join(wt, 'target', 'cargo-timings');
  const files = fs.readdirSync(dir).filter((f) => /^cargo-timing-.*\.html$/.test(f)).sort();
  const html = fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8');
  const m = html.match(/const UNIT_DATA = (\[[\s\S]*?\]);/);
  const units = JSON.parse(m[1]);
  return units
    .filter((u) => /^csp-/.test(u.name))
    .map((u) => ({
      unit: `${u.name} ${u.target.trim() || 'lib'}`,
      total: u.duration,
      frontend: u.rmeta_time ?? null,
    }));
}

function build() {
  const t0 = Date.now();
  const r = spawnSync('cargo', ['test', ...pkgs, '--no-run', '--timings'], {
    cwd: wt,
    encoding: 'utf8',
  });
  const wall = (Date.now() - t0) / 1000;
  if (r.status !== 0) throw new Error(r.stderr.slice(-3000));
  return { wall, units: latestTimings() };
}

const results = [];
try {
  const names = only ? only.split(',') : Object.keys(scenarios);
  for (const name of names) {
    if (name === 'full') {
      for (let k = 0; k < reps; k++) {
        spawnSync('cargo', ['clean', ...pkgs], { cwd: wt });
        const b = build();
        results.push({ kind, name, rep: k, ...b });
        console.log(kind, name, k, b.wall.toFixed(1), JSON.stringify(b.units));
      }
      continue;
    }
    const [file, anchor] = scenarios[name];
    for (let k = 0; k < reps; k++) {
      toggle(file, anchor);
      const b = build();
      results.push({ kind, name, rep: k, ...b });
      console.log(kind, name, k, b.wall.toFixed(1), JSON.stringify(b.units));
    }
  }
} finally {
  clean();
  build(); // leave the tree and its build as they were
  const out = path.join(process.env.T1719_OUT || __dirname, `timings-${kind}-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
  console.log('wrote', out);
}
