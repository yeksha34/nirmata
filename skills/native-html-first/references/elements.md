# Native element reference

Markup and gotchas for each primitive in the lookup table. Jump to a section by name.

Contents: Built-in behavior · Visibility and state · Media and loading · Typography and semantics · Input experience · Navigation and safety

---

## Built-in behavior

### `<dialog>` and `method="dialog"`

```html
<dialog id="confirm">
  <form method="dialog">
    <p>Delete this item?</p>
    <button value="cancel">Cancel</button>
    <button value="ok">Delete</button>
  </form>
</dialog>
<script>
  document.getElementById('confirm').showModal();
</script>
```

- `showModal()` gives a focus trap, Escape-to-close, an inert background and the `::backdrop` pseudo-element.
- Submitting a `method="dialog"` form closes the dialog and sets `returnValue` to the submitter's `value`. No click handler is needed.
- Escape closes without changing `returnValue`, so reset it to `''` before reopening if you read it.
- Use `show()` for a non-modal dialog. Clicking the backdrop does not close a modal natively. Add that yourself only if asked.

### `popover` and `popovertarget`

```html
<button popovertarget="menu-1">Options</button>
<div id="menu-1" popover>…</div>

<button popovertarget="toast-1" popovertargetaction="toggle">Toast</button>
<div id="toast-1" popover="manual">Saved.</div>
```

- `popover` (auto) is light-dismissible: click outside or Escape closes it, and opening one closes others.
- `popover="manual"` stays open until toggled. Use it for toasts.
- Popovers render in the top layer, so `z-index` and stacking contexts stop mattering.
- By default a popover is centered in the viewport. To attach it to its button, use CSS anchor positioning (`anchor-name` on the button, `position-anchor` and `position-area` on the popover) inside `@supports (anchor-name: --a)`.

### `<details name>`

```html
<details name="faq" open><summary>First</summary>…</details>
<details name="faq"><summary>Second</summary>…</details>
```

Same `name` makes the group exclusive. Without support the items behave as independent disclosures.

### `<datalist>`

```html
<input id="city" list="cities">
<datalist id="cities"><option value="Pune"><option value="Mumbai"></datalist>
```

Suggestions only. Free text is still accepted, so validate separately if the value must come from the list.

### `<output for>`

```html
<form>
  <input id="qty" name="qty" type="number"> × <input id="price" name="price" type="number">
  = <output name="total" for="qty price"></output>
</form>
```

The element is the semantic part, and a short `input` listener computes the value. Screen readers can announce changes to it.

---

## Visibility and state

### `hidden="until-found"`

```html
<p hidden="until-found">Collapsed, but find-in-page can open it.</p>
```

- The browser reveals it when the user's search matches, and fires `beforematch` first (use it to update surrounding UI).
- Unsupported browsers hide it permanently. Feature-detect with `'onbeforematch' in document.body` and remove the attribute if absent.

### `inert`

```html
<div inert>…</div>
```

Makes the subtree unclickable, unfocusable and hidden from assistive tech. Use it on the page behind a custom modal instead of a hand-written focus trap.

### `<fieldset disabled>` and `<legend>`

```html
<fieldset disabled>
  <legend>Shipping address</legend>
  <input name="street"> <input name="zip">
</fieldset>
```

One attribute disables every contained control. Disabled controls are not submitted. The legend gives the group its accessible name.

### `<template>` and `<slot>`

```html
<template id="row-tpl"><li><span class="label"></span></li></template>
<script>
  list.append(rowTpl.content.cloneNode(true));
</script>
```

Template content is inert (no scripts run, no images load) until cloned. Pair with `<slot>` inside shadow DOM for web components: slots project the host's children into the template.

---

## Media and loading

### `<picture>`

```html
<picture>
  <source type="image/avif" srcset="a.avif">
  <source type="image/webp" srcset="a.webp">
  <source media="(min-width: 700px)" srcset="a-wide.jpg">
  <img src="a-square.jpg" alt="…" width="300" height="300">
</picture>
```

- The first matching `<source>` wins, so order matters.
- Format negotiation uses `type`. Art direction uses `media`.
- Always keep the `<img>` with `alt` and dimensions. It is the fallback and the element that gets laid out.

### `<img>` hints

```html
<img src="hero.jpg" alt="…" fetchpriority="high">
<img src="below.jpg" alt="…" loading="lazy" decoding="async" width="640" height="400">
```

Mark the hero `fetchpriority="high"` and never `loading="lazy"` (lazy-loading the largest visible image delays it). Everything below the fold gets `loading="lazy"`. Give lazy images dimensions to avoid layout shift.

### Resource hints

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="/f.woff2" as="font" type="font/woff2" crossorigin>
<link rel="modulepreload" href="/main.js">
<link rel="prefetch" href="/next-page">
```

`preconnect` warms a connection, `preload` fetches a critical asset for this page now, `modulepreload` does the same for ES modules, `prefetch` fetches for the next navigation. Fonts need `crossorigin` on preload even for same-origin files.

### `<video>` and `<audio>`

```html
<video controls preload="metadata">
  <source src="a.mp4" type="video/mp4">
  <track kind="captions" src="a.en.vtt" srclang="en" label="English" default>
  Fallback text for old browsers.
</video>
```

`<track kind="captions">` for subtitles, `preload` (`none`, `metadata`, `auto`) controls buffering, and the child text is the fallback.

---

## Typography and semantics

- `<time datetime="2026-10-26">26 Oct</time>`: machine-readable date or duration (`PT4M`). `<data value="SKU-4471">Trail kettle</data>` does this for non-date values.
- `<abbr title>`, `<q>`, `<blockquote cite>`, `<cite>`, `<ins datetime>`, `<del datetime>` carry meaning CSS cannot.
- `<ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby>`: annotation above base text. `<rp>` parentheses show only where ruby is unsupported.
- `<bdi>` isolates user-generated text of unknown direction so it cannot reorder the surrounding line (for example an Arabic username followed by a number). `<bdo dir="rtl">` forces a direction. `<wbr>` offers a break point inside long identifiers or URLs with no visible hyphen.
- `<hgroup><h2>Title</h2><p>Subtitle</p></hgroup>`: keeps heading and subtitle as one outline entry.
- `<search><form role="search">…</form></search>`: search landmark. `<search>` already exposes the landmark role, so a `role` on the inner form is optional.
- `translate="no"`: leave brand names, code and transliterated terms alone.

---

## Input experience

```html
<input autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6">
<input inputmode="decimal">
<input autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false">
<input type="search" enterkeyhint="search">
```

- `autocomplete="one-time-code"` pulls SMS codes into the field on iOS and Android.
- `inputmode` (`numeric`, `decimal`, `tel`, `email`, `search`, `url`) picks the keyboard without changing validation.
- `enterkeyhint` (`search`, `send`, `next`, `done`) relabels the return key.
- `autocapitalize="off"` and `autocorrect="off"` suit usernames, code and identifiers.
- `type="color"`, `"range"`, `"date"` and `"datetime-local"` give native pickers. Their look differs per browser and OS.
- `<meter min max low high optimum value>` shows a gauge, colored by where `value` falls against `low`, `high` and `optimum`. `<progress max value>` shows progress, and with no `value` it is indeterminate.

---

## Navigation and safety

- `<a href download="name.pdf">` suggests a filename for same-origin links.
- `<a ping="/track">` sends a tracking request on click. It is privacy-relevant, so use it sparingly and disclose it.
- `<base target="_blank">` sets the default target for every link in the document.
- `<iframe loading="lazy" sandbox>` defers off-screen embeds and restricts the embedded page. Start from an empty `sandbox` and add only the tokens needed.
- `<map>` and `<area>`:

```html
<img src="plan.png" width="280" height="170" usemap="#plan" alt="Floor plan">
<map name="plan">
  <area shape="rect" coords="200,100,270,160" href="#lake" alt="Lake">
</map>
```

Coordinates are in image pixels, so the image must keep a fixed rendered size. Every `<area>` needs `alt`.
