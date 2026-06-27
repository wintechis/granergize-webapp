import { TierDot } from "webapp";

// The three source tiers a finder item can carry — owned (blue), shared (orange),
// open (green). Labelled so the colour mapping reads at a glance.
export function Tiers() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: "0.95rem",
      }}
    >
      {(["mine", "shared", "open"] as const).map((tier) => (
        <div key={tier} style={{ display: "flex", alignItems: "center" }}>
          <span style={{ textTransform: "capitalize", minWidth: 64 }}>{tier}</span>
          <TierDot tier={tier} />
        </div>
      ))}
    </div>
  );
}
