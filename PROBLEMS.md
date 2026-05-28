# User-Reported Problems

Running list of problems and feedback reported by users.

| # | Status | Title |
|---|--------|-------|
| 1 | Open | Role should be set per-user in profile, not chosen in the add-data UI |
| 2 | Open | Add more user roles (e.g. facility manager, broker/Makler) |
| 3 | Open | No way to delete a building (only edit is possible) |
| 4 | Open | Only the benchmark service provider can add energy data; every role should be able to |
| 5 | Open | No way to update consumption data per month/year or add a new year |
| 6 | Open | Excel import is slow and cannot be cancelled / deferred |
| 7 | Open | Each building should carry address, building specifics, and annual energy consumption |
| 8 | Open | Download template uses the exact Excel received from providers (real data), not a clean template |
| 9 | Open | Role-based sharing from the Praxishandbuch is not implemented in the app |
| 10 | Open | Deactivate the Energy Mix tab (not in Praxishandbuch, confusing for users) |
| 11 | Open | Users cannot upload their company logo |
| 12 | Open | Show the company logo instead of the hats |
| 13 | Open | Map markers should show the company logo too |
| 14 | Open | Login screen lacks an explanation text and a link to the project |
| 15 | Open | Soll-Ist-Vergleich use case is missing from the app (no data sent) |
| 16 | Open | Need planned-vs-actual consumption comparison per building per year |

---

## 1. Role should be set per-user in profile, not chosen in the add-data UI

**Status:** Open

**Description:** Currently a user's role is not fixed — everyone gets access to
everything and picks a role (e.g. investor, user, BSP) when adding data through the
add-data UI. Instead, the role should be assigned per-user in the user profile and
applied automatically, rather than being a selectable option in the add-data flow.

## 2. Add more user roles (e.g. facility manager, broker/Makler)

**Status:** Open

**Description:** The app currently only supports the investor, user, and benchmark
service provider roles. Additional roles should be supported — for example facility
manager or broker (Makler).

## 3. No way to delete a building (only edit is possible)

**Status:** Open

**Description:** Buildings can be edited but not deleted. There should be a way to
delete a building.

## 4. Only the benchmark service provider can add energy data; every role should be able to

**Status:** Open

**Description:** In the add-building flow, the investor and user roles can only add
building specifics — they cannot add energy consumption. Only the benchmark service
provider can add energy and water data (annual observations). Every role should be
able to add energy data.

## 5. No way to update consumption data per month/year or add a new year

**Status:** Open

**Description:** The benchmarker can add benchmarking data, but there is no way to
add or update consumption data per month or per year, nor to add a new year. Only the
benchmark service provider can add energy data at all, and even then existing energy
data cannot be updated for a new year. (Related to #4.)

## 6. Excel import is slow and cannot be cancelled / deferred

**Status:** Open

**Description:** The Excel import takes a long time, and there is no way to cancel an
in-progress upload (e.g. to say "I'll do the upload later").

## 7. Each building should carry address, building specifics, and annual energy consumption

**Status:** Open

**Description:** A building should hold its address, building specifics, and annual
energy consumption data. (Restatement of existing requirements — captured for
completeness; relates to #4 and #5.)

## 8. Download template uses the exact Excel received from providers (real data), not a clean template

**Status:** Open

**Description:** The "Download template" Excel is exactly the data as submitted to us
— the current templates are the exact Excel files received from the data providers,
rather than clean/blank standardized templates.

## 9. Role-based sharing from the Praxishandbuch is not implemented in the app

**Status:** Open

**Description:** The Praxishandbuch describes three different sharing mechanisms,
including role-based access. The app only implements single (per-building) sharing and
aggregated views — the role-based sharing mechanism is missing. It is unclear how the
documented role-based access is supposed to work in the app.

## 10. Deactivate the Energy Mix tab (not in Praxishandbuch, confusing for users)

**Status:** Open

**Description:** The Energy Mix tab could be deactivated — it is not described in the
Praxishandbuch and is rather confusing for users.

## 11. Users cannot upload their company logo

**Status:** Open

**Description:** There is no way for a user to upload their company logo.

## 12. Show the company logo instead of the hats

**Status:** Open

**Description:** Instead of the current "hats" (role/marker icons), it would be nice
to display the user's company logo. (Relates to #11.)

## 13. Map markers should show the company logo too

**Status:** Open

**Description:** The markers on the map should also display the company logo.
(Relates to #11 and #12.)

## 14. Login screen lacks an explanation text and a link to the project

**Status:** Open

**Description:** When not logged in, the user only sees the login screen. It has no
short explanation text and no link to the project.

## 15. Soll-Ist-Vergleich use case is missing from the app (no data sent)

**Status:** Open

**Description:** The project started with nine use cases and is now down to three (as in
the paper): benchmarking, supporting Vertrieb (sales), and Soll-Ist-Vergleich
(target/actual comparison). The Soll-Ist-Vergleich use case is not in the app — partly
because the required data has not been sent.

## 16. Need planned-vs-actual consumption comparison per building per year

**Status:** Open

**Description:** The Soll-Ist-Vergleich needs the planned consumption data per building
(as planned in the architecting phase). There should be functionality to compare energy
consumption — planned vs. actual — for a given year. (Enables #15.)
