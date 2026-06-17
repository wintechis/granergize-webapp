// Granergize logo as an inline PNG (base64), rasterized from public/favicon.svg
// at 128×128 (`rsvg-convert -w 128 -h 128 public/favicon.svg`). Inlined so the
// XLSX export can embed it without a fetch (works in the browser and in Deno
// tests alike). Regenerate and re-encode if the favicon changes.
export const GRANERGIZE_LOGO_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAABmJLR0QA/wD/AP+gvaeTAAAB60lEQVR4nO3cXU7jMBhA0XTEStj/WpgVzGylPPGCkCB2Kxzfc96DEnL1Nf2xjwMAAACouI0eeL/f7488Eebcbrehezl0kJu/ppEITh/g5q/tbAR/nnUiXMPL7B8YfOnhQWYHsgkQJ4A4AcQJIE4AcQKIE0CcAOIEECeAOAHECSBOAHECiBNAnADiBBAngDgBxAkgTgBxAogTQNz0uoBnsxDpuUyAOAFsZGRxqAA2Mbo8fPlngM9GL5SvmQBxAoibfgn494iz4NeYAHECiBNAnADiLvc5wE/VdjMb/XxkywlQu/nHMX7N2wVQvPkfRq59uwA4Z9tngA//N//q4NU+gcwQQJwA4gQQJ4A4AcQJIE4AcQKIE0CcAOIEECeAOAHECSBOAHECiBNAnADiBBAngDgBxAkgbvt1AbO/m5+1+roEEyBuuwDsInbOdgEchwjO2PYZ4LciuNrq5C0nAD8ngDgBxAkgbvoh8PXtEaexr9X/PyZAnADiLvc5wNXeZ6/OBIgTQJwA4tZ/Bvjre51nMgHiBBAngDgBxAkgTgBxAogTQJwA4gQQJ4A4AcQJIE4AcQKIE0CcAOIEECeAOAHECSBOAHECiDv9o3tr89Z2dm8kEyBuaNmNKbCmkZ3RhtddiWAt9kYEAAAAvvMOOThEe2raR5kAAAAASUVORK5CYII=";
