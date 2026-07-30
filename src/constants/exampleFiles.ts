import type { MessageId } from "../lib/messages.ts";

/**
 * The bundled example workbooks offered under "Try an example file" in the
 * Add-building Autofill sub-flow. The files live in `public/examples/` and are
 * emitted by the codegen pipeline (`deno task gen:examples`,
 * `scripts/genExampleFiles.ts`) from the native L.Immo extract + the fictional
 * portfolio data; the dialog fetches one and feeds it through the SAME parse
 * path as a user-picked file.
 *
 * What a spreadsheet cannot carry rides here instead:
 *  - `selfOperatedCodes`/`selfOwnedCodes` — buildings (by `buildingCode`, or
 *    `"all"` for code-less files like a Lastgang profile) whose
 *    `operatedBy`/`ownedBy` is set to the importing user's own WebID at parse
 *    time. That resolves the agent links to a real profile out of the box and
 *    puts ≥2 annual buildings in ONE operator group, so the operator-average
 *    (Betreiber) benchmark shows on the example data.
 *  - `prefill` — form fields merged into every parsed building (the Lastgang
 *    example brings readings + a label but no address, and lat/long are
 *    required to save).
 */
export interface ExampleFile {
  id: string;
  label: MessageId;
  /** File name under `public/examples/`. */
  file: string;
  selfOperatedCodes?: readonly string[] | "all";
  selfOwnedCodes?: readonly string[] | "all";
  prefill?: Record<string, string>;
}

export const EXAMPLE_FILES: readonly ExampleFile[] = [
  {
    id: "limmo",
    label: "exampleLimmo",
    file: "limmo-nuernberg.xlsx",
    // The flagship + the two series-capable buildings + the owner-occupier —
    // the operator group the Betreiber benchmark needs (≥2 with annual data).
    selfOperatedCodes: ["LI-16074", "LI-4095", "LI-3951", "LI-3632"],
    selfOwnedCodes: ["LI-4095", "LI-3951", "LI-3632"],
  },
  {
    id: "portfolio",
    label: "examplePortfolio",
    file: "beispiel-portfolio.xlsx",
    selfOperatedCodes: ["NOP-84", "LG-20", "PIR-68"],
    selfOwnedCodes: ["LG-20", "PIR-68"],
  },
  {
    id: "lastgang",
    label: "exampleLastgang",
    file: "lastgang-am-tower-10.xlsx",
    // A Lastgang file carries readings + a label only; the address makes the
    // one parsed building saveable without typing (LI-4095's real location).
    prefill: {
      streetAddress: "Am Tower 10",
      postalCode: "90475",
      locality: "Nürnberg",
      region: "Bayern",
      lat: "49.3880849341245",
      long: "11.1815593435211",
      geocodePrecision: "Address",
    },
    selfOperatedCodes: "all",
    selfOwnedCodes: "all",
  },
];
