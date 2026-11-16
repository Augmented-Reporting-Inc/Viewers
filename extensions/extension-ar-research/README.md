# AR Research

Schema-driven Research Read panel used by the reusable AR Research / Imaging Core Lab workflow.

## Echo quantitative research read (viewer)

Launch the **existing** longitudinal Echo viewer with the authorized Research
Read context (for an assigned read, `arResearchReviewKey`; for configured
preview, `arResearchStudyKey`). No new viewer mode or extension is required.

The AR Measurements panel now presents validated Echo LA 20-disk biplane
volume, RV fractional area change, and IVC collapsibility summaries when a
Research Read context is active, as well as in the existing clinical-report
workflow. Research measurement saves are performed through **Research Read →
Save**, not the clinical report's Save Measurements button.

Research Read `readSchema.components[].config.measurementLabels` may bind
a numeric field to any of these **method-specific** derived candidates:

| Field value | Example `measurementLabels` | Expected unit |
| --- | --- | --- |
| Simpson biplane LV EF | `["LVEF"]` | `%` |
| LA biplane summation of 20 disks | `["LAVolumeDisks"]` | `mL` |
| RV fractional area change | `["RVFAC"]` | `%` |
| IVC collapsibility | `["IVCCollapsibility"]` | `%` |
| Source TR peak velocity | `["TRVel", "TR Vmax"]` | `m/s` |

Bindings only transfer valid physical values with matching units; derived
values include the underlying annotation identifiers in `sourceMeasurementKey`.
For LA volume, the 20-disk method is **not** the legacy area-length method.
No pediatric RAP value is inferred from IVC dimensions.

## Optional protocol-defined RVSP field

When an imaging profile requires an RVSP calculation, define TR Vmax as a
viewer-bound numeric component, RAP as an **explicit manually entered** numeric
component, and RVSP as a calculated numeric component:

```json
{
  "schemaKey": "echo-hemodynamics",
  "schemaVersion": "1",
  "domain": "echo",
  "components": [
    {
      "componentKey": "trVmax",
      "label": "TR peak velocity",
      "kind": "measurement",
      "required": true,
      "config": { "unit": "m/s", "measurementLabels": ["TRVel", "TR Vmax"] }
    },
    {
      "componentKey": "rap",
      "label": "Selected RAP (per protocol)",
      "kind": "number",
      "required": true,
      "config": { "unit": "mmHg" }
    },
    {
      "componentKey": "rvsp",
      "label": "Derived RVSP",
      "kind": "number",
      "required": true,
      "config": {
        "unit": "mmHg",
        "step": 0.1,
        "calculation": {
          "type": "rvsp",
          "trVmaxComponentKey": "trVmax",
          "rapComponentKey": "rap"
        }
      }
    }
  ]
}
```

The displayed RVSP is read-only and equals **4 × TR Vmax² + RAP** when a
source-linked TR velocity and explicit RAP are present. With missing inputs
or incompatible units, it remains blank and does not satisfy a required
field. The formula does **not** estimate RAP, diagnose pulmonary pressure,
or determine applicability in patients with RV outflow obstruction. Pediatric
study protocols and clinician judgment govern interpretation.

The optional calculated field requires the three referenced components to
have the same read segment; it does not combine unrelated segments or
cross-link different research reads.

## Demonstration / regression checklist

- Use a permitted, de-identified echo study with calibrated TR, IVC, LA,
  LV, and RV source views. Confirm Research Read and Echo Measurements
  appear together, without a new viewer mode.
- Capture labelled TR Vmax. Confirm the configured field reads the correct
  value in m/s and the source annotation is present.
- Enter RAP **explicitly** according to the research protocol. Verify
  calculated RVSP (e.g. 3.0 m/s and 3 mmHg → 39 mmHg); clear RAP and
  confirm RVSP clears. Do **not** label the adult IVC RAP estimator pediatric.
- Draw IVC expiration/inspiration; verify collapse and two source frames.
- Draw RV ED/ES areas; verify FAC, source frames and calibration.
- Draw LA A4C/A2C contours; verify the 20-disk result is separate from
  legacy biplane area-length.
- Complete LV Simpson contours; confirm EDV/ESV/EF and source-frame jumps.
- Save Research Read, close, reopen, check values, annotations and links;
  Complete Read locks edits. Verify read-only mode and protocol preview.
- Regression-test clinical-report mode (including 20-disk, FAC, IVC)
  and one learning/viewer quiz workflow. Non-research save targets should
  retain their existing behavior.
