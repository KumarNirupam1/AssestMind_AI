// Read-only verification of the AI4I guardrail rules against the dataset's own
// label columns. Touches no database and writes nothing.
//
// HDF, PWF and OSF are expected to reproduce their labels exactly. TWF and RNF
// are not thresholded in AI4I and are expected NOT to be reproducible; the
// script asserts that too, so a future "fix" that fakes them fails loudly.
// See docs/adr/0002-ai4i-guardrail-rules.md.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = join(root, "data", "raw", "ai4i2020.csv");

const raw = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
const lines = raw.trim().split(/\r?\n/);
const header = lines[0].split(",");
const rows = lines.slice(1).map((line) => {
  const cells = line.split(",");
  return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
});

const AIR = "Air temperature [K]";
const PROCESS = "Process temperature [K]";
const SPEED = "Rotational speed [rpm]";
const TORQUE = "Torque [Nm]";
const WEAR = "Tool wear [min]";

const n = (r, k) => Number(r[k]);
const flag = (r, k) => n(r, k) === 1;
const udis = (list) => new Set(list.map((r) => r["UDI"]));

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
}

function sameRows(a, b) {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

console.log(`AI4I guardrail rule verification — ${rows.length} rows\n`);

// --- HDF: abs(process - air) < 8.6 K AND speed < 1380 rpm
const hdfLabel = udis(rows.filter((r) => flag(r, "HDF")));
const hdfCalc = udis(
  rows.filter((r) => Math.abs(n(r, PROCESS) - n(r, AIR)) < 8.6 && n(r, SPEED) < 1380),
);
check(
  "HDF reproduces its label exactly",
  sameRows(hdfLabel, hdfCalc),
  `label ${hdfLabel.size}, computed ${hdfCalc.size}`,
);

// --- PWF: power = torque * 2*pi*speed/60 watts; fail below 3500 W or above 9000 W
const pwfLabel = udis(rows.filter((r) => flag(r, "PWF")));
const power = (r) => (n(r, TORQUE) * 2 * Math.PI * n(r, SPEED)) / 60;
const pwfCalc = udis(rows.filter((r) => power(r) < 3500 || power(r) > 9000));
check(
  "PWF reproduces its label exactly",
  sameRows(pwfLabel, pwfCalc),
  `label ${pwfLabel.size}, computed ${pwfCalc.size}`,
);

// --- OSF: toolWear * torque > 11000 (L) / 12000 (M) / 13000 (H)
const osfLimit = { L: 11000, M: 12000, H: 13000 };
const osfLabel = udis(rows.filter((r) => flag(r, "OSF")));
const osfCalc = udis(rows.filter((r) => n(r, WEAR) * n(r, TORQUE) > osfLimit[r["Type"]]));
check(
  "OSF reproduces its label exactly (per product type)",
  sameRows(osfLabel, osfCalc),
  `label ${osfLabel.size}, computed ${osfCalc.size}`,
);

// The per-type split is load-bearing: a flat 11000 over-counts.
const osfFlat = udis(rows.filter((r) => n(r, WEAR) * n(r, TORQUE) > 11000));
check(
  "OSF per-type split is load-bearing (flat 11000 over-counts)",
  osfFlat.size > osfLabel.size,
  `flat 11000 gives ${osfFlat.size} vs ${osfLabel.size}`,
);

// --- TWF: not a threshold. The wear band contains far more rows than are labelled.
const twfRows = rows.filter((r) => flag(r, "TWF"));
const wearBand = rows.filter((r) => n(r, WEAR) >= 200 && n(r, WEAR) <= 240);
const twfOutside = twfRows.filter((r) => n(r, WEAR) < 200 || n(r, WEAR) > 240);
check(
  "TWF is NOT a wear-band rule (band far exceeds labelled rows)",
  wearBand.length > twfRows.length * 5,
  `${twfRows.length} labelled vs ${wearBand.length} rows in the 200-240 band`,
);
check(
  "TWF has rows outside the documented 200-240 band (irreducible)",
  twfOutside.length > 0,
  `${twfOutside.length} such rows`,
);

// --- RNF: a per-row coin flip. Documented as 5 rows; the release has 19.
const rnfRows = rows.filter((r) => flag(r, "RNF"));
check(
  "RNF count differs from the UCI documentation (doc says 5)",
  rnfRows.length !== 5,
  `CSV has ${rnfRows.length} (${((rnfRows.length / rows.length) * 100).toFixed(2)}% of rows)`,
);

// --- Machine failure is OR of the modes, with a known residue of
// unattributed rows. AI4I ships 9 rows with Machine failure=1 and every mode
// flag clear; the seed stores the other 330 as FaultRecords and keeps these 9
// as readings only. Pinning the count guards against a silent data change.
const MODES = ["TWF", "HDF", "PWF", "OSF", "RNF"];
const failure = rows.filter((r) => flag(r, "Machine failure"));
const attributable = failure.filter((r) => MODES.some((m) => flag(r, m)));
const unattributed = failure.length - attributable.length;
check(
  "unattributed failures match the documented AI4I residue of 9",
  unattributed === 9,
  `${unattributed} rows have Machine failure=1 with all modes clear`,
);
check(
  "attributable fault rows match the seeded FaultRecord count",
  attributable.length === 330,
  `${attributable.length} attributable failures`,
);

// --- The "1413" rule must stay debunked.
const speedRange = [Math.min(...rows.map((r) => n(r, SPEED))), Math.max(...rows.map((r) => n(r, SPEED)))];
const tsRange = [
  Math.min(...rows.map((r) => n(r, TORQUE) * n(r, SPEED))),
  Math.max(...rows.map((r) => n(r, TORQUE) * n(r, SPEED))),
];
check(
  "no 1413 threshold is plausible for torque x speed",
  1413 < tsRange[0],
  `torque x speed spans ${tsRange[0].toFixed(0)}..${tsRange[1].toFixed(0)}; 1413 is a speed value, not a limit`,
);
check("rotational speed range brackets 1413 (it is a value, not a limit)", speedRange[0] < 1413 && speedRange[1] > 1413,
  `speed spans ${speedRange[0]}..${speedRange[1]}`);

console.log();
if (failures.length) {
  console.error(`${failures.length} check(s) failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("All guardrail rule checks passed.");
