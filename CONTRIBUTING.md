# Contributing to LAYR

Thanks for helping improve LAYR, a free, open-source touchscreen interface for Klipper/Moonraker.

## Before you start

- Check existing issues and pull requests to avoid duplicate work.
- For significant feature or architecture changes, open an issue to discuss the approach first.
- Keep changes focused. Include screenshots for touchscreen UI changes at **1024×600** and **800×480**.
- Never include API keys, personal credentials, printer configuration secrets, or private user data in commits or issue reports.

## Local development

Requires Node.js 22.12 or newer.

```bash
npm ci
npm run check
npm test
npm run build
```

For the browser end-to-end suite, install Playwright Chromium once, then run `npm run test:e2e`.

## Pull requests

1. Branch from `main`; make one focused change per pull request.
2. Explain the problem, the approach, and testing performed.
3. Add or update tests for functional changes. Provide screenshots for visible changes.
4. Keep backwards compatibility and avoid unexpected changes to KlipperScreen, Klipper, Moonraker, AFC, and Happy Hare.
5. Do not request testers to execute unreviewed scripts or printer motion/heating commands.
6. Submit a PR for review; do not assume automatic merging or physical printer deployment.

## Licensing

LAYR is licensed under [GNU GPL v3](LICENSE). By submitting contributions, you agree to have your contributions distributed under the same license. Please only contribute material you have the right to license.
