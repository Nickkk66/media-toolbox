# media toolbox — promo video plan (TODO: build tomorrow)

A 15-second advertisement, equal parts **product demo + motion graphic**. Cream
brand (matches the new site + app theme). **Music + UI click SFX**, no voiceover.
All visuals invented (no real screen recordings needed). Built with **HyperFrames**.

- **Engine:** `/motion-graphics` (motion-is-the-message, <=~30s, invented visuals),
  themed as a product ad. HyperFrames renders from HTML, so REUSE the site's exact
  brand: cream `#fbeede`, Bricolage Grotesque + Figtree, the same SVG icons, the M
  mark, the pink highlighter swipe paths. Video <-> site <-> app = one identity.
- **Master:** 16:9 @ 30fps. Optional 9:16 cut (Reels/TikTok/Shorts) + a silent
  transparent loop for the site hero. (Decide aspect at build time.)

## Beat sheet (15s @ 30fps)

| Time | Beat | Motion | Audio |
|------|------|--------|-------|
| 0.0-2.0 | Logo build | M chart-line draws on, pink dot pops, "media toolbox" + v1.0 fade up | music in, soft tick on dot |
| 2.0-3.0 | Hook | "Your whole media studio. / Now on your PC" — pink highlighter wipes across PC | swipe whoosh |
| 3.0-9.0 | Tool montage (the demo) | 8 feature icons snap into the grid on-beat; 2-3 morph into mini fake-UI cards (convert dropdown, compress slider, bg-removal before->after) | click per snap, accelerating |
| 9.0-11.5 | Differentiator | cluttered competitor window full of X'd ad blocks flashes, swept away by the pink swipe -> "No ads. No catch." lands w/ highlight | whoosh + stamp |
| 11.5-14.0 | Value flash | "Free. Open source. 100% offline." ticks in line by line | three ticks |
| 14.0-15.0 | CTA lockup | M + wordmark center; dark "Download for Windows" pill plays its arrow-morph once | satisfying clunk, music button-out |

## Production steps
1. `/motion-graphics` -> init project, 15s/30fps, cream brand tokens.
2. Author scenes as timed clips w/ GSAP (seekable/deterministic).
3. Media: resolve background music + click/whoosh/clunk SFX into `.media/`.
4. Reuse `docs/` SVG icons + M mark + swipe paths for pixel-consistency.
5. Preview -> lint/validate -> render MP4 (+ 9:16 + transparent-loop variants).

## Extra ideas / stretch
- Each feature icon could reuse its NEW site hover animation as its montage entrance
  (arrows fly in for Convert, scissors clip for Remove backgrounds, sound rings for
  Transcribe, lightning for Blazing fast, pink sparkle for On-device AI) so the ad
  teaches the site's interactions.
- End card could spin the pink 8-point star (the Source-hover star) around the M.
- A "drag a 4GB file in -> done" micro-beat to hammer the no-size-limit angle.
- Numbers beat: "8 tools. 0 ads. 0 uploads." count-up.
