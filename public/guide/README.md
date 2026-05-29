# Screenshots for the in-app guide (#/guide)

Drop PNG screenshots of the **current** UI here. `GuidePage.tsx` references them
by name; any missing file is hidden automatically (no broken image), so you can
add them incrementally.

Expected files (capture from the logged-in app):

| File              | Screen to capture                                            |
| ----------------- | ------------------------------------------------------------ |
| `anmelden.png`    | Login: the "Choose an Identity Provider" dialog              |
| `room.png`        | **Room** tab — create/join a room, role selection            |
| `add-building.png`| **Sharing** tab — "Buildings you own" (Add Building / Autofill from file) |
| `map-tabs.png`    | **Map** tab — a selected building with the Building/Energy/Weather tabs |
| `sharing.png`     | **Sharing** tab — share / per-building download / revoke     |
| `create-view.png` | The **Create View** dialog                                   |

Recommended: ~1200px wide PNG, light theme. Keep file sizes modest (these ship
in the static build and load on the guide page).
