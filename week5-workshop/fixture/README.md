# fixture — a small broken project for the agent to fix

`parseDuration("1h30m")` returns `31`. It should return `5400`: the function
adds the numbers and ignores the unit entirely.

The bug is deliberate, it is real (this is a genuine off-by-a-multiplication),
and there is a test that catches it:

```bash
node --test --experimental-strip-types utils.test.ts
```

`npm run sandbox` in the workshop root copies this folder to `sandbox/`, which
is where Parts 2-5 run. Break it, let the agent fix it, copy it again.
