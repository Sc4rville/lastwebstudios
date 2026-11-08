---
name: web-cinematics
description: >
  The cinematic layer of a prospect's site: key frames and video clips (hero,
  atmosphere, interactive reveals, scroll-scrub) generated from the assets already
  boosted by asset-boost. Runs on every prospect (the score > 65 gate is lifted; cinematic:false brings it back).
user-invocable: true
argument-hint: "<prospectId>"
license: Apache 2.0
metadata:
  status: active
---

# web-cinematics

## Pipeline

parse → diagnose → asset-boost → web-cinematics → composer

Inputs:
- `data/prospects/<id>.json` — the prospect fiche
- `data/prospects/<id>.brief` — angle + diagnosis
- `data/assets/<id>/` — real photos, audited and boosted (`_audit.json`, `_boost.json`, job_ids)
- `design/industries/<industry>/playbook.md` — the trade's mood and needs

Output: `data/assets/<id>/_cinematics.json`

asset-boost produces the real. web-cinematics produces the generated and the interactive. The generated serves the atmosphere, the hero and the movement. It never invents a past project.

---

## Step 0 — The target feeling

One single question, before everything else:

**When the visitor leaves this site, what did they feel?**

The answer is physical and emotional, never visual: overwhelmed by luxury, reassured by precision, envious of a way of life, confident in a craft. That sentence becomes the single criterion. Any effect that doesn't reinforce it is cut.

Then, an inventory of the real assets. Read `_audit.json` and `_boost.json`. Work out what each photo really is, which one carries the target feeling most strongly (the hero), which ones support it, and what is missing to tell the story.

Output: the target feeling in one sentence, the inventory ranked by narrative strength, the gaps to fill.

---

## Step 1 — Read each asset as an opportunity

For each asset and each section, look for a dimension that goes beyond the still image.

**A before/after transformation.** A pool liner laid, then the pool filled and lit. A raw wall, then finished. A job site, then the handover. A face before and after. A candidate for an interactive reveal.

**A hidden structure or a process.** The layers of a coating, the inside of a mechanism, the steps of an installation, the technical side of a build. A candidate for a breakdown revealed on scroll or on hover.

**A space to walk through.** A property and its rooms, a venue from the bar to the terrace, a workshop and its areas. A candidate for a scroll-scrub room tour.

**A central object.** A bottle, a piece of furniture, a piece of equipment. A candidate for a breakdown or a rotation driven by scroll.

An asset that carries only one reading becomes a passive clip. An asset that carries a transformation, a structure, a route or a rotation deserves an interactive pattern.

---

## Step 2 — Compose the movement

Movement is never decorative. It is the target feeling translated into a trajectory. Before animating anything, phrase the movement with a verb of physical direction and an aim. If the sentence doesn't hold, the decision hasn't been made.

The gesture follows from the subject and the intent. A precious detail calls for a slow approach. A big space calls for a pull-back that reveals its scale or a fly-over that dominates it. A living material — water, flame, steam, fabric — is filmed almost still; the movement comes from the material itself. Time passing is told by light sliding from day to dusk. Compose the gesture for this precise trade; the list of examples is only a starting point, not a menu.

---

## Step 3 — Choose the section pattern

### Passive clip

A loop or a shot that plays with no interaction. Heroes, section backgrounds, atmospheric transitions.

### Before/after reveal

Two states of the same subject stacked, the second revealed on hover or drag. Generate two key frames framed and lit identically, state A then state B. Reference state A in `medias` to generate B so the place and style are kept.

### Scroll-scrub

A video whose playback follows the scroll position: the visitor moves through the shot by going down the page. It serves the room-by-room tour, the layer-by-layer breakdown of a product, a 360° rotation of an object, the progressive reveal of a technical space.

Think of the video as a timeline of states rather than a shot to watch. Continuous, slow movement, no cut, 6 to 15 seconds long, no sound needed. Each second maps to a precise step of the route, so that any scroll position lands on a readable frame. Note the time → step mapping for the composer.

---

## Step 4 — Choose the video tool

The criterion is the kind of movement, not the number of shots.

When you control exactly the camera's start and end points: **Kling 3.0**, start frame and end frame.

When the main movement is free physics — water, smoke, fabric, fire, hair — or a continuous shot for scroll-scrub: **Seedance 2.0**.

On a multi-shot storyboard with cuts: **Seedance 2.0**.

Kling 3.0 requires the end frame to be a really moved point of view, not the start frame barely turned. The camera has travelled: a blurry detail has become sharp in the foreground, the central object has become small in a revealed space, a new element has come in from one edge while another went out, the ground has given way to the sky. Generate the end frame by referencing the start one in `medias` to keep the place and style, with a frankly moved framing. Kling interpolates the trajectory between the two.

The turbo and fast variants are for previews and tests, not for delivery.

---

## Step 5 — Prepare the key frames

Key frames always start from the real. Two routes, never generation from nothing.

Direct route: a photo boosted by asset-boost works as is as a frame. You reuse its boost job_id. It is the default when the asset already carries the framing and light you want.

Edited route: `gpt_image_2` when the source must be transformed — reframe for a 16:9 or 21:9 hero, reframe to 3:4 for a column, produce state B of a before/after, adjust the light or mood towards the trade's palette, or generate the moved end frame of a Kling shot. The real source is always referenced in `medias` by its boost job_id, never by a CloudFront URL. Pass the avatar ID explicitly when a recurring avatar appears.

`nano_banana_2` is not used here. No frame is generated without a real asset as a reference.

One image per beat. Keep every job_id: the video depends on them.

---

## Step 6 — Generate the clips

`get_cost:true` before each video call. Generate with the chosen tool. Cut out only after generation, never before: `remove_background` with `media_type:"video"`. Produce the mobile variant with a 9:16 `reframe` from the source, without regenerating.

---

## Output — `_cinematics.json`

For each beat: the pattern (`passive_clip`, `hover_reveal`, `scroll_scrub`), the feeling served, the frame job_id(s), the video job_id, the alpha job_id if cut out, the ratio, the duration, the loop, the mobile variant. For a hover_reveal, the two frames and the axis. For a scroll_scrub, the time → step table. The total cost in credits.

The full storyboard and the target feeling go at the top of the file. The agent routes the integration.
