---
name: native-html-first
description: Check for a built-in HTML element or attribute before writing JavaScript, a custom component or a library. Use whenever the user asks for or is about to hand-build a modal, dialog, popup, dropdown menu, tooltip, toast, accordion, collapsible FAQ, autocomplete, disabled form section, lazy-loaded or responsive image, mobile keyboard or OTP input, progress bar, gauge, image hotspot, or any similar UI widget in HTML, React, Vue, Svelte or plain JS. Also use when reviewing front-end code that reimplements one of these, when the user asks "is there a native way", "do I need JS for this", or wants lighter, more accessible markup, even if they never mention native HTML.
---

# Native HTML first

Before writing a custom component, ask whether the browser already has a primitive for it. Native elements ship with keyboard handling, focus management and screen reader semantics that hand-rolled versions usually get partly wrong, and they cost no bundle size. That is why the check comes first: it is cheap, and a hit removes code instead of adding it.

## Workflow

1. **Name the behavior, not the component.** "Something opens over the page, traps focus and closes on Escape" is a `<dialog>`. "Only one section open at a time" is `<details name>`. Match on what the user needs to happen.
2. **Look it up in the table below.** If a row fits, read the matching section of [references/elements.md](references/elements.md) for the exact markup and the gotchas.
3. **Check support before relying on it.** Newer features are marked below. For those, use the native element as the baseline and add JavaScript only to fill the gap (see "Progressive enhancement"). When the project has a browser target (browserslist, a stated minimum), check it. If unsure, say which feature is newer and let the user decide.
4. **Use the native version, then say what it replaced.** One sentence is enough ("`<dialog>` gives you the focus trap and Escape handling, so the modal needs one `showModal()` call"). Users should see what they got for free.
5. **Keep JavaScript for what markup cannot do.** Opening a modal programmatically, reading `returnValue`, computing an `<output>` value and registering a custom element all still need a few lines. Write only those.

If nothing fits, build the custom component and say the native check came up empty. Do not force a native element onto a job it does not do, for example a `<datalist>` when the options must be restricted to the list.

## Lookup table

| The user needs | Reach for | Newer or patchy |
|---|---|---|
| Modal with focus trap, Escape, backdrop, inert background | `<dialog>` + `showModal()`; `<form method="dialog">` for buttons | Widely supported |
| Menu, tooltip, toast or other overlay without `z-index` fights | `popover` + `popovertarget` | Widely supported; anchoring via CSS anchor positioning is newer |
| Exclusive accordion | `<details name="group">` | Newer; older browsers get independent disclosures |
| Autocomplete that still allows free text | `<input list>` + `<datalist>` | Widely supported; styling is limited |
| Calculated result tied to inputs | `<output for>` | Widely supported |
| Collapsed content that find-in-page can open | `hidden="until-found"` | Newer; unsupported browsers keep it hidden, so add a fallback |
| Disable an entire subtree (for example behind a custom modal) | `inert` | Widely supported |
| Disable a group of form controls | `<fieldset disabled>` + `<legend>` | Widely supported |
| Repeated markup, web component base | `<template>`, `<slot>` | Widely supported |
| Image format negotiation or art direction | `<picture>` + `<source>` | Widely supported |
| Image load priority | `loading`, `decoding`, `fetchpriority` | `fetchpriority` is newer |
| Early connection or asset fetch | `rel` values `preconnect`, `preload`, `modulepreload`, `prefetch` | Widely supported |
| Captions, buffering control | `<track kind="captions">`, `preload` | Widely supported |
| Machine-readable dates and values | `<time datetime>`, `<data value>` | Widely supported |
| Pronunciation or gloss text | `<ruby>`, `<rt>`, `<rp>` | Widely supported |
| Mixed-direction text, break opportunities | `<bdi>`, `<bdo>`, `<wbr>` | Widely supported |
| Heading plus subtitle, search landmark | `<hgroup>`, `<search>` | `<search>` is newer |
| Stop translation of brand names or code | `translate="no"` | Widely supported |
| SMS code, right mobile keyboard, return key label | `autocomplete="one-time-code"`, `inputmode`, `enterkeyhint`, `autocapitalize`, `autocorrect` | Behavior varies by OS; effect is mostly mobile |
| Native pickers | `type` values `color`, `range`, `date`, `datetime-local` | Widely supported; look differs per browser |
| Gauge or loading state | `<meter>`, `<progress>` (no `value` for indeterminate) | Widely supported |
| Clickable image regions | `<map>` + `<area>` | Widely supported; coordinates do not scale with the image |
| Sandboxing third-party embeds, deferring them | `<iframe sandbox loading="lazy">` | Widely supported |

"Widely supported" is a summary, not a guarantee. Confirm against MDN or the project's browser target when the answer matters.

## Progressive enhancement

Where support is patchy, the native element is still the right baseline:

- `<details name>` degrades to independent disclosures that still work. Add a small script only if exclusivity is required.
- `hidden="until-found"` degrades to fully hidden content. Feature-detect with `'onbeforematch' in document.body` and drop the attribute when it is false.
- `popover` anchoring: leave the popover as a centered overlay by default and place it with CSS anchor positioning inside `@supports (anchor-name: --a)`.
- A custom modal that already exists should at least apply `inert` to the page behind it instead of a hand-written focus trap.

## Attributes with privacy or scope cost

- `<a ping>` sends a tracking request. Mention the privacy angle and use it only when the user wants that.
- `<base target>` changes every link on the page. Point that out before adding it.
- `<iframe sandbox>`: start with no permissions and add only what the embed needs. `allow-scripts` together with `allow-same-origin` lets an embed from the same origin remove its own sandbox, so avoid combining them for same-origin content.

## Reviewing existing code

When asked to review or refactor, flag hand-rolled versions of anything in the table, such as a focus-trap helper, a `useClickOutside` hook for menus, an accordion state machine or an IntersectionObserver for image lazy loading. Propose the native replacement and note anything the custom code does that the native element does not (for example, animating the close of a `<dialog>`), so the user can decide with the trade-off in view.

## Demonstrating

If the user wants to see these working, start from [assets/playground.html](assets/playground.html), a ready-made single page with live examples and the markup under each one. Open it directly or adapt it. To build a fresh one, put the real element and its markup side by side and mark demos that need a line or two of script. Say plainly when an example cannot run in the viewing environment (blocked external images, embeds or downloads) and show the markup instead.
