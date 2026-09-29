#!/bin/bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
check_dir="$(mktemp -d /tmp/cpu-schedule-palette.XXXXXX)"
trap 'rm -rf "$check_dir"' EXIT
cd "$repo_dir"
# Node 24 reads the actual Web TypeScript palette; do not duplicate its hash.
node --input-type=module - "$check_dir/fixtures.json" <<'JS'
import {writeFileSync} from 'node:fs';
import {getColorGlassCourseTone, getScheduleThemePalette} from './web/src/components/jwxt/scheduleTheme.ts';
const fixtures = [];
for (const name of ['英语 III', '药理学实验与实践', '  高等\n数学  ', '药学🧪实验', '生物化学', '\u0085课程\u0085', '\ufeff课程\u00a0 A ', '课程'.repeat(80)]) {
  for (const dark of [false, true]) {
    const tone = getColorGlassCourseTone(name, dark);
    const stops = tone.bg.match(/hsla\([^)]*\)/g);
    fixtures.push({name, palette:'color-glass', dark, top:stops[0], bottom:stops.at(-1), border:tone.border, text:tone.text});
  }
}
for (const palette of ['green', 'blue', 'teal', 'indigo', 'violet', 'orange', 'rose', 'slate']) {
  const tone = getScheduleThemePalette(palette);
  for (const name of ['英语 III', '药学🧪实验']) {
    fixtures.push({name, palette, dark:false, top:tone.courseBg, bottom:tone.courseBg, border:tone.courseBorder, text:tone.courseText});
  }
}
writeFileSync(process.argv[2], JSON.stringify(fixtures));
JS
swiftc ios_next/CpuTime/CpuTime/NativeSchedulePalette.swift ios_next/tests/NativeSchedulePaletteChecks.swift -o "$check_dir/checks"
"$check_dir/checks" "$check_dir/fixtures.json"
