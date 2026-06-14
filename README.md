# Granergize WebApp

The Granergize WebApp allows browsing and comparing energy consumption data of
different buildings using the
[Granergize Ontology](https://solid.ti.rw.fau.de/gra/vocab.ttl#).

## Pre-requisites

- [Deno2](https://deno.land/) installed

## Setup

- Clone the repository
- Run `deno install` to install dependencies
- Run `deno task dev` to start the development server
- Open `http://localhost:5173` in your browser
- Run `deno task dev:local` (or `dev:local:jss`) for a fully local stack — a
  throwaway Pod + IdP with seeded logins, no remote Pod needed

## License

Copyright (C) 2025–2026 Thomas Wehr, Andreas Harth and the Granergize project
contributors.

This program is free software: you can redistribute it and/or modify it under
the terms of the **GNU Affero General Public License, Version 3** (AGPL-3.0) as
published by the Free Software Foundation. See the [`LICENSE`](LICENSE) file for
the full text.

Because the AGPL is designed for network-served software, anyone who runs a
modified version of this app as a network service must offer the corresponding
source code to its users.
