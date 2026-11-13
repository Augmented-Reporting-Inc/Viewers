# AR physical measurement and presentation contract

## Platform rule

Every AR domain (echo clinical, echo education, bowel/iUSCAN, spectral, other
measurement tools) separates **acquisition calibration**, **verified physical
quantity**, **presentation policy**, and **persistence/scoring**.

- A tool creates/edits geometry. Tool-specific DICOM/acquisition calibration
  produces the physical quantity. A pixel length or area is not a clinical unit.
- The validated physical value and its explicit source unit are authoritative.
  Cornerstone cachedStats can be an input only after the applicable source
  validation. A text label never proves calibration.
- A measurement-kind policy selects a display unit. Conversion MUST change the
  value and unit together; never relabel a number without converting it.
- Viewport annotations, measurement panels, education answer previews, and
  saved/restored displays should consume the *same* verified physical result.
- Source/frame/annotation references and calibration provenance remain attached
  to the physical measurement. An invalid or unavailable calibration is shown
  as unavailable, never a fabricated or default mm/mm² value.
- Scoring compares normalized physical numbers with explicitly compatible
  dimensions, not formatted strings.
- Tenant/role differences are policy configuration, not scattered tenant names.
  An invalid dimension override is refused; existing policy remains the default.

## Initial frontend implementation

The pure conversion and display-policy foundation lives in:

`extensions/extension-ar-measurements/src/utils/physicalMeasurementPresentation.ts`

It exports:

- `normalizePhysicalUnit`, `getPhysicalUnitDimension`
- `convertPhysicalValue(value, sourceUnit, targetUnit, requiredDimension?)`
- `resolveMeasurementDisplayPolicy(measurementKind, override?)`
- `presentVerifiedPhysicalMeasurement(measurement, override?)`

The last function deliberately requires `verified: true`. It does **not**
independently validate DICOM spatial calibration, contour geometry, source
instance/frame, annotation integrity, or acquisition provenance. The upstream
measurement calculator must do that. An unknown kind or unit, absent data,
pixel unit, mismatched dimension, or invalid override returns `null`.

A presentation result contains the converted `value`, `unit`, and `text`,
the original source value/unit, and caller-provided calibration provenance.
The consumer must not recalculate from unrelated ROI cachedStats.

Initial product defaults include:

| Measurement | Display |
|---|---|
| RV ED/ES and RA/LA areas | cm² |
| LV/LA volume | mL |
| Bowel wall thickness and IVC diameter | mm |
| EF, RV FAC, IVC collapsibility | % |
| TR peak velocity | m/s |
| TR VTI | cm |
| Deceleration time | ms |
| RVSP | mmHg |

A valid unit override (for example cm² to mm² for area) converts the
number as well as the label. The defaults are **not** one global display unit
for every area/length; measurement-specific requirements apply.

The first integration reuses this converter in:
`extensions/extension-ar-measurements/src/utils/echoAreaMeasurements.ts`,
`extensions/extension-ar-measurements/src/utils/rightHeartMeasurements.ts`,
and `extensions/extension-ar-measurements/src/utils/laVolume.ts`.
The clinical field mappings and source calibration/evidence validation are
unchanged by this phase.

## API and persistence boundary

Frontend and backend do not share files. FormAPI's API schema and scoring
rules require their own, independently maintained implementation and tests.

Future API normalization should explicitly record, where supported by the
existing persistence contract, the physical numeric value, canonical source
unit, measurement kind/dimension, calibration status/source, source
SOP/frame reference, annotation ID and geometry. Display text is derived,
not an authoritative persistence field. Do not rewrite existing records
without a backward-compatible read adapter and non-destructive migration plan.

## Incremental migration and release gates

1. **Foundation (this PR):** shared frontend conversion/policy and tests;
   first calculator integrations without changing report UOM or score rules.
2. **Viewer/rendering integration (follow-up, building on PR #110's
   complete source history):** reuse one authoritative quantity in live Cornerstone text,
   saved hydration, AR panels and education answer previews. Remove duplicate
   overrides after confirming new and old restore paths. No text-only changes.
3. **Broader domain adapters:** independently verify echo clinical, bowel,
   spectral and other tools; preserve each original calibration source and
   configured units. Test tenant-configured defaults and disabled behavior.
4. **API and scoring alignment:** version explicit frontend/backend contracts;
   validate physical dimensions, provenance and source frames without importing
   frontend files in FormAPI. Maintain older snapshots/readback compatibility.

Required tests for later stages: creation, edit, delete, save, reopen, report,
learner capture/scoring, invalid/no DICOM spatial calibration, pixel-only ROI,
cine source-frame mismatch, conflicting metadata, tenant configuration overrides,
and representative unaffected clinical/bowel workflows.

**This initial PR does not yet replace all Cornerstone annotation renderers,
all persistence paths, or backend scoring.** Do not infer complete end-to-end
compliance from passing conversion-unit tests.
