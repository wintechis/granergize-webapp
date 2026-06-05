# User-Reported Problems

Running list of problems and feedback for the GRANERGIZE WebApp.

Sources referenced below:
- **Handbuch** = `GRANERGIZE_Handbuch.pdf` (Praxishandbuch, April 2026); `HWnn` =
  the review comments ("Kommentiert [HWnn]") embedded in that document.
- **Paper** = `paper.pdf` ("A Decentralized Approach to Sharing Energy Consumption
  Data of Logistics Real Estate", Solid Symposium 2026).

All 23 problems were checked against the source code on 2026-05-28. 21 reproduce as
described; #4 and #21 (marked `Open*`) were corrected to match the actual code behavior.

**Update 2026-05-29:** statuses revised after the data-room / sharing / login work —
#8, #10, #14 are **Done**; #1, #9, #20 are **Partial**. Details in each section below.

**Update 2026-06-04:** after the tab reorg, Excel export, and the role→provenance
(PROV) refactor — **#3** is now **Done** (building delete shipped); **#12/#13** are
nudged forward (the role "hats" map markers were removed, though company logos are
still not shown); **#1** stays **Partial** but the building "role" is now modelled
correctly as PROV provenance (provenance-only, no longer driving behaviour).

**Update 2026-06-05:** after the energy-model redesign (one `gran:EnergyDataset` per
building/year/granularity/scenario) and the Recharts chart migration —
**#5** is now **Done** (a per-year "Add / edit energy year" form writes/updates one
dataset per year), and **#15 / #16** are **Done** (a *planned* scenario plus the
investor/BSP charts overlaying planned beside actual give the Soll-Ist comparison per
building per year; weather-based normalization remains out of scope — see #18). **#17**
moves to **Partial** (each year is now its own shareable resource, but the share UI
still exposes only the two building-level levels). Each item below notes its spec/test
coverage.

| # | Status | Title |
|---|--------|-------|
| 1 | Partial | Role should be set per-user in profile, not chosen in the add-data UI |
| 2 | Open | Add more user roles (e.g. facility manager, broker/Makler) |
| 3 | Done | No way to delete a building (only edit is possible) |
| 4 | Open* | Energy data entry is inconsistent across roles (original "only BSP" claim corrected) |
| 5 | Done | No way to update consumption data per month/year or add a new year |
| 6 | Partial | Excel import is slow and cannot be cancelled / deferred |
| 7 | Open | Each building should carry address, building specifics, and annual energy consumption |
| 8 | Done | Download template uses the exact Excel received from providers (real data), not a clean template |
| 9 | Partial | Role-based sharing from the Praxishandbuch is not implemented in the app |
| 10 | Done | Deactivate the Energy Mix tab (not in Praxishandbuch, confusing for users) |
| 11 | Open | Users cannot upload their company logo |
| 12 | Open | Show the company logo instead of the hats |
| 13 | Open | Map markers should show the company logo too |
| 14 | Done | Login screen lacks an explanation text and a link to the project |
| 15 | Done | Soll-Ist-Vergleich use case is missing from the app (no data sent) |
| 16 | Done | Need planned-vs-actual consumption comparison per building per year |
| 17 | Partial | Individual sharing has only two levels; cannot share a single year's energy data |
| 18 | Open | External-knowledge linking (weather / benchmark standards) is not available in the app |
| 19 | Open | No standardized input mask per role |
| 20 | Partial | Data Room functionality (partner discovery) is not integrated into the WebApp |
| 21 | Open* | Aggregated-view revocation sends no notification (building revocation now does) |
| 22 | Open | Demonstrator stores data on external/public Pods; should run on a controlled hoster |
| 23 | Open | Unclear whether the Vertriebsoptimierung (sales-support) use case is supported |

---

## 1. Role should be set per-user in profile, not chosen in the add-data UI

**Status:** Partial (2026-05-29; refined 2026-06-04) — roles are self-assigned per user
in the Room tab, independent of the add-data flow, and persist as audited events. As of
2026-06-04 the building "role" is no longer an overloaded data attribute: it is modelled
as **PROV provenance** (`prov:qualifiedAttribution` / `prov:hadRole` in the building
file) and is *provenance only* — it no longer drives parsing, loading, or rendering
(those dispatch on the data's own shape/granularity). As of 2026-06-05 the add-data
selector is also decoupled from data-room membership: it is a plain import **template**
chooser (`AddBuildingDialog.tsx`), always available, so you no longer need to hold a role
in a data room to add a building — the room role is purely a *sharing* concept now. Still
not bound to the WebID **profile** / applied fully automatically (the chosen template is
still recorded as the provenance category), so the status stays Partial.

**Description:** Currently a user's role is not fixed — everyone gets access to
everything and picks a role (e.g. investor, user, BSP) when adding data through the
add-data UI. Instead, the role should be assigned per-user in the user profile and
applied automatically, rather than being a selectable option in the add-data flow.

**Source:** Handbuch HW5 ("Wie kann ich meine eigene Rolle festlegen? Bisher nur 3
Rollen bei Dateneingabe und Teilen der aggregierten Daten").

## 2. Add more user roles (e.g. facility manager, broker/Makler)

**Status:** Open

**Description:** The app currently only supports the investor, user, and benchmark
service provider roles. Additional roles should be supported — for example facility
manager or broker (Makler). The paper's logistics-ecosystem model lists a fuller set
of roles: users, owners, facility managers, developers, financiers, brokers, energy
suppliers, and benchmark service providers.

**Source:** Handbuch HW11 ("Nicht alle Rollen vorhanden, nur Investor, Nutzer und
BSP"); Paper §2 (role list).

## 3. No way to delete a building (only edit is possible)

**Status:** Done (2026-06-04) — the Manage tab has a per-building "Delete building"
action (`ManagePage.tsx` → `useDeleteBuilding` → `deleteBuilding`, `buildingSerializer.ts`)
that de-registers the source, deletes the building file, and removes its energy subtree
(refusing to touch buildings outside the user's own Pod). **Spec:** e2e
`e2e/building-delete.spec.ts` (click the Manage "Delete building" row action → the
building's row disappears and the owned-building count drops by one); unit
`buildingSerializer.test.ts` ("deleteBuilding deletes the building file…", "refuses a
building outside the user's own Pod") + `podDelete.test.ts` (recursive subtree delete,
abort mid-run, `removeAppData` wipes `granergize/` but never `profile/`).

**Description:** Buildings can be edited but not deleted. There should be a way to
delete a building.

**Source:** Handbuch HW10 ("Wie können Gebäude wieder gelöscht werden?").

## 4. Energy data entry is inconsistent across roles

**Status:** Open (claim corrected after code verification)

**Description:** Energy-data entry differs by role in the add-building flow: the
**investor** and **benchmark service provider** roles have annual energy/water form
fields, the **user** role has none and can only supply energy via the Lastgang
(load-profile) file upload. The original report ("only BSP can add energy; investor and
user can only add building specifics") is inaccurate — investor has annual energy
fields, and the user role can import energy via file. The underlying ask stands: energy
entry should be consistent and available to every role (ideally via a standardized
form, see #19), not split between form fields and file-only paths.

**Source:** Handbuch HW12 ("Sowohl als Nutzer als auch als Investor können nur
Gebäudespezifika eingegeben werden, keine Energieverbrauchsdaten"). Code:
`AddBuildingDialog.tsx` (investor energy fields ~533-569, BSP energy fields ~572-596,
user Lastgang upload ~264-293).

## 5. No way to update consumption data per month/year or add a new year

**Status:** Done (2026-06-05) — a per-year "Add / edit energy year" form
(`EnergyYearDialog.tsx`, opened from each building's row on the Manage tab) writes one
`gran:EnergyDataset` per (year, scenario) via `writeEnergyYear`
(`buildingSerializer.ts`). Because each year is now its own resource
(`<year>-<granularity>[-planned].ttl`, see the energy-model redesign), adding a new year
or editing an existing one is a self-contained write — the fields no longer exist only
at create-time. **Spec:** e2e `e2e/energy-entry.spec.ts` (enter an actual *and* a planned
figure for a year, then confirm the actual flows into the energy view); unit
`energyDataset.test.ts` + `buildingSerializer.test.ts`.

**Description:** The benchmarker can add benchmarking data, but there is no way to
add or update consumption data per month or per year, nor to add a new year. As BSP
the energy fields are available once, when first creating a building, but they
**disappear when editing an existing building** — so there is no way to update
consumption data afterwards. (Related to #4.)

**Source:** Handbuch HW13/R12 ("Als BSP kann man Energieverbrauchsdaten einmal beim
Anlegen des Gebäudes eingeben, aber beim Bearbeiten verschwinden diese Felder → wie
kann man Verbrauchsdaten updaten?").

## 6. Excel import is slow and cannot be cancelled / deferred

**Status:** Partial (2026-06-05) — the in-progress upload is now **cancellable**:
the Add-building dialog threads an `AbortSignal` through `writeBuildingEnergy` /
`uploadBuilding` (and the per-building loop), and the busy overlay shows the live
requests + a "Cancel upload" button. Cancelling aborts promptly between writes;
any buildings already fully written are kept (the building file is written last,
so a mid-energy cancel leaves orphaned partial energy files but no half-building
in Manage). **Spec:** e2e `excel-upload` (import an investor template + cancel a
long 15-min upload); unit `buildingSerializer.test.ts` ("writeBuildingEnergy
stops writing daily files once aborted"). **Still open:** the upload is still
*slow* for a 15-min year (~365 sequential daily-file writes, bounded at
concurrency 8 to stay under the Cloudflare throttle), and there is no *deferred /
background* upload ("do it later") — dismissing the dialog still cancels.

**Description:** The Excel import takes a long time, and there is no way to cancel an
in-progress upload (e.g. to say "I'll do the upload later").

**Source:** Handbuch HW14/R12 ("Nutzer kann granulare Daten über Excel-Template
hochladen → lange Ladezeit ohne Abbruchmöglichkeit").

## 7. Each building should carry address, building specifics, and annual energy consumption

**Status:** Open

**Description:** A building should hold its address, building specifics, and annual
energy consumption data. (Restatement of existing requirements — captured for
completeness; relates to #4 and #5.)

## 8. Download template uses the exact Excel received from providers (real data), not a clean template

**Status:** Done (2026-05-29; export is Excel as of 2026-06-04) — the real-data
"Download template" was removed; buildings instead offer a per-building data export
(now `.xlsx`, plus a "Download all" workbook). **Spec:** unit `buildingSerializer.test.ts`
round-trips `buildingToXlsx` / `buildingsToXlsx` (export → re-import); e2e
`e2e/excel-export.spec.ts` asserts the browser download fires with the right filenames and
that an exported workbook re-imports to the same buildings (full round-trip + cleanup).

**Description:** The "Download template" Excel is exactly the data as submitted to us
— the current templates are the exact Excel files received from the data providers,
rather than clean/blank standardized templates.

**Source:** Handbuch HW17 ("hier werden die mit echten Daten ausgefüllten Templates,
die uns die Partner zur Verfügung gestellt haben, runtergeladen").

## 9. Role-based sharing from the Praxishandbuch is not implemented in the app

**Status:** Partial (2026-05-29) — the data room resolves a role to its member WebIDs
(`getMembersByRole`), so you can share with the people holding a given role via the
room's member list. Not yet a one-click "share with all of role X", nor role-adapted
granularity (e.g. yearly vs 15-minute) — see #17.

**Description:** The Handbuch describes three sharing mechanisms (Abbildung 5):
individual building data, aggregated views, and **role-based access**. The app only
implements individual (per-building) sharing and aggregated views — the role-based
sharing mechanism is missing. It is also unclear whether aggregated views can be
shared with roles other than BSP. The documented role-based access (share data at a
granularity adapted to the recipient's role — e.g. yearly figures for an investor,
15-minute data for an energy manager) is not available.

**Source:** Handbuch §5.1 + Abbildung 5, HW18 ("Wie funktioniert das?"), HW22
("Limitiert auf BSP oder Teilen auch mit anderen Rollen möglich?").

## 10. Deactivate the Energy Mix tab (not in Praxishandbuch, confusing for users)

**Status:** Done (2026-05-29) — the Energy Mix tab/page was removed (the standalone
Views page was also folded into Sharing). An energy-mix summary now appears only as a
panel under the map for the currently visible buildings.

**Description:** The Energy Mix tab could be deactivated — it is not described in the
Praxishandbuch and is rather confusing for users.

## 11. Users cannot upload their company logo

**Status:** Open

**Description:** There is no way for a user to upload their company logo.

## 12. Show the company logo instead of the hats

**Status:** Open (partly addressed 2026-06-04) — the role-based "hats" are gone: map
markers no longer vary by role (`ExplorePage.tsx` dropped `ROLE_ICONS` for a single
marker style distinguished only by owned vs shared). The remaining ask — showing the
*company logo* on the marker — still isn't implemented (depends on #11).

**Description:** Instead of the current "hats" (role/marker icons), it would be nice
to display the user's company logo. (Relates to #11.)

**Source:** Handbuch HW16 ("Anstatt der Hüte auf den Gebäuden in der Karte würden die
jeweiligen Firmenlogos gut aussehen").

## 13. Map markers should show the company logo too

**Status:** Open (partly addressed 2026-06-04) — see #12: markers are now a single
non-role style (owned vs shared); the company-logo marker still isn't implemented.

**Description:** The markers on the map should also display the company logo.
(Relates to #11 and #12.)

**Source:** Handbuch HW16.

## 14. Login screen lacks an explanation text and a link to the project

**Status:** Done (2026-05-29) — the login screen now shows an intro describing the app
and project links (Granergize@FAU, Granergize@IIS) above the provider choices. **Spec:**
credential-free e2e `smoke.spec.ts` ("the sign-in screen renders") asserts the
"Granergize App" heading, the identity-provider buttons, and the Identity-Provider field.

**Description:** When not logged in, the user only sees the login screen. It has no
short explanation text and no link to the project. (The Handbuch assumes an
explanation is shown on the start page, but it is not.)

**Source:** Handbuch HW6 ("Man sieht keine Erklärung, nur Solid Login - Choose an
Identity Provider for this Solid Application").

## 15. Soll-Ist-Vergleich use case is missing from the app (no data sent)

**Status:** Done (2026-06-05) — the Soll-Ist-Vergleich is now in the app. The per-year
energy form (#5) writes a **planned (Soll)** scenario alongside the **actual (Ist)**
figure (`gran:scenario gran:Planned`/`gran:Actual`), and the investor/BSP energy charts
overlay the planned bars beside the actual ones per year (`InvestorEnergy.tsx` /
`BspEnergy.tsx`). So the use case no longer depends on data being "sent" — a user can
enter both series and see the comparison. Weather-normalized comparison is a separate,
still-open requirement (see #18). **Spec:** e2e `e2e/energy-entry.spec.ts` writes both
scenarios; unit `MetricBarChart.test.tsx` asserts the chart renders both the actual and
the `(planned)` series in its legend.

**Description:** The project started with nine use cases and is now down to three (as in
the paper / Handbuch §2.3): Energieverbrauchsbenchmark, Vertriebsoptimierung, and
Soll-Ist-Vergleich (target/actual comparison). The Soll-Ist-Vergleich use case is not
in the app — partly because the required data has not been sent.

**Source:** Paper §2; Handbuch §2.3.

## 16. Need planned-vs-actual consumption comparison per building per year

**Status:** Done (2026-06-05) — planned consumption is captured per building per year as
a `gran:Planned`-scenario `gran:EnergyDataset`, and the investor/BSP charts compare it
against the actual scenario for each year (the overlay described in #15). The remaining
Handbuch sub-requirement — folding in **weather data** to normalize for external
influences — is not done and is tracked under #18. **Spec:** as #15 (e2e
`energy-entry.spec.ts` + unit `MetricBarChart.test.tsx`).

**Description:** The Soll-Ist-Vergleich needs the planned consumption data per building
(as planned in the architecting phase). There should be functionality to compare energy
consumption — planned vs. actual — for a given year. Per the Handbuch this also requires
weather data to account for external influences on consumption. (Enables #15.)

**Source:** Handbuch §2.3 (Soll-Ist-Vergleiche); relates to #18 (weather data).

## 17. Individual sharing has only two levels; cannot share a single year's energy data

**Status:** Partial (2026-06-05) — the data model now supports per-year sharing: each
year is a separate `gran:EnergyDataset` resource, and `shareBuildingData`
(`interop/share.ts`) grants the individual dataset files (and, for a 15-minute series,
its daily-files container) rather than one monolithic energy blob. What's still missing
is the **UI**: the share dialog continues to offer only the two building-level levels
(static only / static + all energy), with no picker to grant a single year. So the gap is
now in the front-end, not the storage model. **Spec:** sharing fold/grant logic is unit
-covered (`sharingManager.test.ts`, `sharingLog.test.ts`) and the two-pod grant path by
e2e `sharing.spec.ts`; the per-year share UI is not yet built or spec'd.

Separately (2026-06-05), **aggregated-view sharing now has a recipient side** — previously
the `kind:View` grant reached the recipient's `shared-in/` log but no reader surfaced it
(`getSharedViews` was sender-only, `SharePage` listed only buildings, `/#/view/:id`
resolved against the viewer's own Pod). Added `getReceivedViews` (folds `shared-in/` for
`View`, mirroring `getSharedWithMe`), the `useReceivedViews` hook, a login invalidation,
and a **"Views shared with you"** section on `SharePage` that opens the shared snapshot via
`loadComputedSnapshot` and renders its values (table + bar chart). **Spec:** unit
`sharingManager.test.ts` ("getReceivedViews folds shared-in/ View grants" + revocation);
two-pod e2e `e2e/view-sharing.spec.ts` (A hosts a room → B joins → A creates+shares a view
→ B sees it under "Views shared with you" and the values render).

**Description:** When sharing individual building data, the app offers only two levels:
(a) static building data only, and (b) static building data plus energy readings. Energy
data is stored per year in separate files (paper §3.1), so it should be possible to
share only the energy data of a specific year — but the UI does not offer this.

**Source:** Handbuch HW8 ("Bei Teilen von individuellen Gebäudedaten gibt es nur
folgende Auswahlmöglichkeit: static building data only / static building data and
energy readings. Wie teilt man nur Energiedaten eines bestimmten Jahres?"); Paper §3.1.

## 18. External-knowledge linking (weather / benchmark standards) is not available in the app

**Status:** Open

**Description:** The Handbuch describes linking building data with external knowledge —
e.g. automatically fetching weather data for a region to compute heating degree days, or
pulling international benchmark reference values for a building classification. It is
unclear whether the WebApp actually does this; it appears not to be implemented.

**Source:** Handbuch §4.4 ("Verknüpfung mit externem Wissen"), HW9 ("Kann WebApp
das?"). Note: a weather-data integration exists in the app (WeatherData page / weather
API proxy) — verify how far this requirement is already met.

## 19. No standardized input mask per role

**Status:** Open

**Description:** There is no standardized data-entry form per role; each role's input
mask differs / is incomplete. (Relates to #1, #2, #4.)

**Source:** Handbuch HW15/R12 ("Keine standardisierte Eingabemaske für die Rollen").

## 20. Data Room functionality (partner discovery) is not integrated into the WebApp

**Status:** Partial (2026-05-29) — data rooms are now in the WebApp (Room tab): create
a room on your Pod, join via URI/QR, self-assign role(s), see members, and resolve a
role to its members (`getMembersByRole`) — the partner-discovery primitive. Not yet
implemented: the provider eliciting each member's data requirements per role and
publishing the resulting exchange-pairs. See ROOM.md.

**Description:** The paper's central concept of "Data Rooms" — a Provider opens a room,
invites members, members self-assign roles, the Provider elicits each member's data
requirements per role, and the collected exchange pairs are published so members can
discover matching partners — is not part of the WebApp. The paper explicitly names
integrating Data Room functionality into the WebApp as the key area for future work.

**Source:** Paper §2 (Data Room scenario) and §4 (future work).

## 21. Aggregated-view revocation sends no notification to the recipient

**Status:** Open (partially fixed; scope narrowed after code verification)

**Description:** The paper/Handbuch describe revocation sending no notification as a
known limitation. In the current code this has been **fixed for individual buildings**:
building-access revocation posts an `AccessRevocation` message to the recipient's inbox
(`sharingManager.ts:264-270`, via `notifyAccessRevoked`). However, **aggregated-view**
revocation still sends no notification (`sharingManager.ts:809-823` removes the ACL and
registry entry but posts nothing). So the gap remains only for shared views.

**Source:** Paper §3.2; Handbuch Abbildung 9. Code: building revoke notifies
(`sharingManager.ts:264-270`); view revoke does not (`sharingManager.ts:809-823`).

## 22. Demonstrator stores data on external/public Pods; should run on a controlled hoster

**Status:** Open

**Description:** The current demonstrator stores data on external Solid Pods (e.g.
solidcommunity.net), which does not yet meet data-protection requirements. In future
the data storage should run via a controlled hoster (e.g. Hetzner or own
infrastructure) so that data protection is guaranteed.

**Source:** Handbuch §3.2 (highlighted: "Aktueller Demonstrator hat Sicherheiten noch
nicht, weil Datenspeicherung auf externen Datenspeichern erfolgt. Zukünftig soll dies
über einen Hoster ... passieren, damit der Datenschutz gewährleistet wird").

## 23. Unclear whether the Vertriebsoptimierung (sales-support) use case is supported

**Status:** Open

**Description:** Vertriebsoptimierung (sales support) is one of the three target use
cases (visualizing energy performance of properties to support sales/marketing and
collaboration between brokers, FMs, and users). It is unclear whether the current
WebApp version supports this use case.

**Source:** Handbuch §2.3 + HW1 ("Können wir das mit bisheriger WebApp-Version?");
Paper §2.
