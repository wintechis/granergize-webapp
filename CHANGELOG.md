# Changelog

All notable changes to the Granergize WebApp project will be documented in this file.

## [2026-05-31]
- Specify the organisation you work for (avatar menu → "Organisation…"): name, logo, homepage, optional org WebID, stored inline in the WebID via W3C Org (org:memberOf) + FOAF; the avatar shows the org logo (falls back to the personal photo)

## [2026-05-30]
- Profile logo upload (foaf:img on WebID); avatar shows it, falls back to vcard:hasPhoto
- Show the building URI in the detail pane
- One typography scale in the theme; ESLint guard against inline font sizes
- Lighter map legend/energy-mix; flexbox layout (no magic-number heights)
- Dialogs ignore backdrop clicks and confirm discard on Esc
- Remove the footer "Anleitung" link (kept in avatar menu)

## [2026-05-29]
- Brand the login screen with a GRANERGIZE description, project links, and the solid.iis.fraunhofer.de identity provider
- Add a SIOC-based data room: self-assign your role and share buildings with everyone holding a given role
- Move sharing to a full-page Sharing tab; avatar menu reduced to Profile + Logout
- Render the Home map immediately and keep it mounted across tabs for faster loads
- Unify link styling; mark external URIs (↗) distinctly from in-app references
- Consistent margins and titles across Map/Views/Sharing/Data Room tabs
- Energy mix panel under the map, aggregated over the visible map area (bbox)
- Split Sharing and Data Room into separate tabs; show the room URI
- Data room: join/leave membership is independent of role assignment (member can hold no role)
- Data rooms are user-created on your own Pod (auto-ACL), addressed by URI; pick the active room by create, paste, or scanning its QR code (and share a room as a QR code)
- Faster initial load: energy files fetched in parallel; map paints before energy loads
- Remove unused energy-mix code/data; add offline-fixture tests for data loading
- Fix stale lists after edits (e.g. deleting a view): read mutable Pod files cache-free via a shared fetchFresh helper
- Rename the Data Room tab to "Room"; remove the refresh button next to the user icon
- Share-view dialog lists the room's members with an Add button (WebID field kept)
- Event-source the data room as an append-only log (membership + role events); document the model in ROOM.md
- Document bilateral (WebID-to-WebID) building/view sharing in SHARING.md
- Rename the app to "Granergize Data Rooms"
- Consolidate aggregated Views into the Sharing tab; remove the standalone Views page
- Room UX: auto-join on opening a room, leaving removes it, "Your rooms" switcher, URI reachability check, current-room card with copy + QR
- Room invite deep links (#/room/:uri); the QR encodes the app invite link
- Login: use the FAU logo image, scale the Solid emblem correctly, refine the intro copy
- Move "Add Building" to the Sharing tab under a new "Buildings you own" heading
- Add bulk "Autofill from file" next to Add Building (opens the dialog's file picker; review the parsed set, then save)
- Single-room model: one current room you're in (+ a persistent bookmark list), both stored on your own Pod (granergize/rooms.ttl) — no localStorage; entering a room leaves the previous; Add/Scan only bookmark, click a bookmark to enter
- Uniform "normal" button size and bulletless lists across the app
- Per-building data export (Turtle) next to every building you can access; remove the blank-template download
- Reorder Sharing sections: own, views, shared, shared-with-me
- Building detail pane uses tabs (Building data / Energy data / Weather data) instead of links below the card
- In-app German how-to guide (#/guide, from footer + avatar menu) with screenshots and "Als PDF speichern" (browser print)
- Add Playwright E2E: credential-free smoke tests run in CI (deno task e2e); an opt-in script captures the guide screenshots from a throwaway Pod
- Login: auto-remember the identity provider (drop the "save login info?" prompt); solidcommunity.net listed first; clearer "Sign in (again) with…" section labels; no confirm on CLEAR
- Map: details enlarge/shrink is now a small icon on the building heading row (was a big header button)
- Trim top whitespace above the first section on each tab
- Internal: reuse fetchFresh / a shared Turtle-serialize helper, and read the room registry once per refresh
