# Idle Home photo sizing — Issue #59

Matched screenshots use mocked Moonraker, a fixed clock, and a generated 600×900 portrait printer
illustration. They are browser fixtures, not photographs or captures from the physical Raspberry Pi.
The before images use main at `dec231e`; the after images use the 58% idle Home inset.

| Display | Before | After | Rendered photo size, before → after |
| --- | --- | --- | --- |
| 1024×600 | [Before](before-1024x600.png) | [After](after-1024x600.png) | 245×368 → 142×213 px |
| 800×480 | [Before](before-800x480.png) | [After](after-800x480.png) | 181×272 → 105×158 px |

Sizes describe the photo painted inside the `object-fit: contain` box, not the full preview frame.
The Home card, preview frame, and selected-photo footer retain identical positions and dimensions
in each before/after pair. The original no-photo idle screen remains covered by browser regressions.
