# Dataset provenance

## `raw/ai4i2020.csv`

| | |
|---|---|
| Dataset | Predictive Maintenance Dataset (AI4I 2020) |
| Author | Stephan Matzka |
| Source | Kaggle — `stephanmatzka/predictive-maintenance-dataset-ai4i-2020` |
| Retrieved | 2026-09-26 |
| Size | 522,048 bytes |
| Rows | 10,000 data rows + 1 header |
| Columns | 14 |
| SHA-256 | `dc6630cd9b1f0f853922fad78a1b6436570d3f1ec863f1dd5c4340ac56bc8a8e` |
| Licence | CC BY-NC-SA 4.0 |

### Required citation

> S. Matzka, "Explainable Artificial Intelligence for Predictive Maintenance
> Applications," 2020 Third International Conference on Artificial
> Intelligence for Industries (AI4I), 2020, pp. 69-74,
> doi: [10.1109/AI4I49448.2020.00023](https://doi.org/10.1109/AI4I49448.2020.00023)

Milling-process imagery: Daniel Smyth, [Pexels](https://www.pexels.com/de-de/foto/industrie-herstellung-maschine-werkzeug-10406128/).

### Columns

`UDI`, `Product ID`, `Type`, `Air temperature [K]`, `Process temperature [K]`,
`Rotational speed [rpm]`, `Torque [Nm]`, `Tool wear [min]`, `Machine failure`,
`TWF`, `HDF`, `PWF`, `OSF`, `RNF`

Column → `SensorReading` mapping:

| CSV column | Field | Notes |
|---|---|---|
| `UDI` | `id` | 1–10000, unique |
| `Type` | `qualityVariant` | L / M / H → `QualityVariant` enum |
| `Air temperature [K]` | `airTempK` | float, ~300 K |
| `Process temperature [K]` | `processTempK` | float, air + ~10 K |
| `Rotational speed [rpm]` | `rotationalSpeedRpm` | integer |
| `Torque [Nm]` | `torqueNm` | **float**, ~40 Nm — not an integer |
| `Tool wear [min]` | `toolWearMin` | integer, 0–253 |
| `Machine failure` + `TWF`…`RNF` | `machineFailure`, `twf`, `hdf`, `pwf`, `osf`, `rnf` | ground-truth labels |
| `Product ID` | — | derived from `Type`; not stored |

Temperatures are Kelvin, dataset-native. Store K, display °C.

### Two parsing traps

1. **UTF-8 BOM.** The file begins with `EF BB BF`, so the first column name
   parses as `﻿UDI`, not `UDI`. Strip it before mapping column names, or
   index positionally. The file is kept byte-identical to the source so the
   checksum above stays verifiable — do not "fix" the BOM in place.
2. **Torque is a float** (`40.2`), while rotational speed and tool wear are
   integers. The Kaggle data dictionary describes torque as normally
   distributed around 40 Nm, and the values carry a decimal part.

### Ground-truth caveat

`Machine failure` is 1 if **any** of the five modes is true, so it does not
identify the cause. The `TWF`/`HDF`/`PWF`/`OSF` columns are the per-mode
labels. `RNF` is a 0.1% random chance, **not** a threshold — it must never be
reimplemented as a rule. See `docs/assetmind-ai-architecture.md` §3.2.
