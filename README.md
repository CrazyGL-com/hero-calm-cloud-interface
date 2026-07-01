<sub>*Hero made by [@ybouane](https://x.com/ybouane).*</sub>
<p align="center">
  <img src="https://crazygl.com/heroes/hero-calm-cloud-interface/banner-full.png" alt="Calm Cloud Interface" width="640">
</p>

# @crazygl/hero-calm-cloud-interface

A SaaS dashboard floats among soft cloud sprites under a friendly cream-to-sky-blue sky. Pointer drift parallaxes both the camera and the layered clouds for a light, approachable, effortless mood.

## Demo
[Calm Cloud Interface](https://crazygl.com/hero/calm-cloud-interface)

## Install

```bash
npm install @crazygl/hero-calm-cloud-interface
```

## Usage

```tsx
import CalmCloudInterface from '@crazygl/hero-calm-cloud-interface';

export default function Hero() {
  return (
    <CalmCloudInterface
      screenshot="https://example.com/your-dashboard.avif"
      cloudCount={8}
      skyTop="#b8d8f5"
      skyBottom="#fff5e8"
    />
  );
}
```

## Customise

- **Content** — heading + subheading, two-column, or custom node, with optional heading font.
- **Screen** — `screenshot` (PNG/JPG/WebP/AVIF; the plane derives its aspect from the image), plus `screenshotScale`, `screenshotX`/`screenshotY` offsets and `screenshotTilt`.
- **Clouds** — `cloudCount` (4–14), `cloudColor`, `cloudOpacity`, `cloudDriftSpeed`, `cloudSpeed` multiplier.
- **Sky** — `skyTop` / `skyBottom` gradient colours.
- **Motion** — `pointerCameraDrift` and `pointerParallax`.
- **Background** — `transparentBackground` to composite over your own page.

## Best for

- Productivity tools, HR and people platforms, and education apps.
- Consumer SaaS where the brand should feel light, calm and effortless.
- Product launches that want a dashboard screenshot front and centre.



This hero is part of [CrazyGL](https://crazygl.com), a collection of production-ready WebGL, canvas, 3D, and typography effects. Every CrazyGL hero ships with an agent-ready `SKILL.md` file that helps developers and coding agents adapt the effect into custom landing pages and interactive experiences.
