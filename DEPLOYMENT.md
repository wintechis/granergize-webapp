# Deployment

Build and copy the static `dist/` to the host's `public_html` (served at
`https://paul.ti.rw.fau.de/~ec69etyl/testing/granergize/`):

```bash
export PATH="$HOME/.deno/bin:$PATH"
deno task build
scp -r dist/* ec69etyl@paul.ti.rw.fau.de:public_html/testing/granergize/
```
