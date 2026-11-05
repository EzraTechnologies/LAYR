# Security policy

LAYR is in beta and controls real 3D printers through Moonraker. Treat unexpected printer movement, heating, cancellation, and privileged installer operations as potentially safety-relevant.

## Reporting a vulnerability

Please **do not publish sensitive exploit details, credentials, or private printer access information** in a public issue.

Use GitHub's **Report a vulnerability** / private security advisory feature in the repository's Security tab, when available. If that feature is not enabled, contact the repository maintainers privately through their published project contact channel rather than opening a public issue with exploit details.

Provide affected versions or commits, expected versus actual behavior, and reproduction steps that do not risk uncontrolled motion or heating. Do not include personal secrets or full printer configuration files.

## Supported versions

Security fixes are prioritized for the latest release and the current `main` branch during beta. Older versions may not receive backports.

## Safe deployment

- Run the installer as the regular printer user, not root.
- Keep KlipperScreen available as a fallback until LAYR is verified.
- LAYR's local web service binds to `127.0.0.1` by default. Do not expose an unauthenticated Moonraker console to the public internet.
- Review scripts and release artifacts before installation, and do not paste private tokens into issues.
