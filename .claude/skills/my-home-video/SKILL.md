---
name: my-home-video
description: >-
  Plan, capture, edit, and verify videos of the my-home project. Use for Remotion reels, before-and-after footage
  from Git history, photo-to-model comparisons, walkthroughs, and demonstrations of the viewer's rendering.
---

# Create a my-home video

Agree on the story and duration before a full capture. Identify what each shot needs to prove and test an
actual opening and ending frame before recording motion. Keep captions short enough to read at delivery size.

- For a development milestone, find the introducing commit with `git log` and check the model and seed stored
  at that revision. [The reel capture script](../../../tools/reel/capture.mjs) uses temporary Git archives and
  loopback API fixtures to load the archived viewer, model, and placements without deploying them.
- When comparing renderers, hold the room, furnishings, aspect ratio, field of view, and camera path constant.
  Capture overlapping camera poses on both sides of each transition. For a photo match, use the stored pose and
  horizontal field of view, then check the alignment against features visible in both frames. Use the
  [photo-modelling skill](../my-home-photo-modelling/SKILL.md) to obtain private reference photos.
- For cutaways, sections, and eye-level footage, use the actual [viewer controls](../../../docs/views.md).
  Preview the first and last capture frames and check that the viewport and the captured canvas have the
  intended framing. A mobile controls sheet can resize the canvas even when its contents are hidden. Check
  the pixel dimensions of the exported canvas. For motion, drive each frame from the composition clock and
  export from the drawing buffer after the requested frame has rendered.

## Capture and edit

[tools/reel](../../../tools/reel/README.md) contains an editable Remotion example, pinned capture and rendering
dependencies, and a script for its original score. The example's commits, camera path, and timings belong to that
edit. Adapt these to the approved storyboard. The capture script accepts shot names to rerun one part of the
edit. Keep working media in a private temporary directory and supply it via Remotion's `--public-dir`.
Use the shared heavy-job queue where available.

Keep reference photos, captures containing photos, and rendered videos with private material out of Git and
PR attachments. Use local exports for review and follow the [project rules](../../../AGENTS.md) for the
house and photo store.

## Verify the delivery

Preview motion at normal speed. Sample each scene and both sides of cuts from the encoded export. Compare a
suspect moment with the source capture in the same framing to locate whether it came from the viewer, capture,
or final edit. Pay particular attention to first-frame readiness, timing across shots, and interpolation at
occlusions. A valid MP4 can still contain visual defects.

From the repo root, after installing the reel tools or with FFmpeg and FFprobe on PATH:

```sh
node .claude/skills/my-home-video/scripts/verify-export.mjs /path/to/reel.mp4 30 1080 1920 30
```

Pass the expected duration in seconds, width, height, and frame rate for the approved edit. This checks
H.264 with 4:2:0 pixel format, AAC if audio is present, dimensions, duration, and decoded frame count, then
decodes the full file. Check that the delivered audio matches the edit's intent.
