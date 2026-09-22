# Local `remark-wiki-link` plugin

This directory contains the website’s local implementation of
[`@flowershow/remark-wiki-link`](https://github.com/flowershow/remark-wiki-link).
It keeps wiki-link parsing inside this repository instead of depending on the
external Flowershow package.

The implementation is based on the upstream plugin’s MIT-licensed behavior and
supports Obsidian-style wiki links in Markdown and MDX.

## Supported syntax

### Internal links

```md
[[Internal link]]
[[Internal link|Custom text]]
[[Internal link#Heading]]
[[Internal link#Heading|Custom text]]
```

Links are rendered as anchors with the `internal` class. Unresolved links also
receive the `new` class.

### Media embeds

```md
![[image.png]]
![[image.png|800x600]]
![[video.mp4]]
![[audio.mp3]]
![[document.pdf]]
```

The plugin emits image, video, audio, and PDF elements based on the file
extension. Image and video dimensions are exposed through
`data-fs-width` and `data-fs-height` attributes.

Markdown and MDX embeds are represented as transclusion-style links. Full note
content transclusion is not implemented.

## Configuration

The plugin is configured in `astro.config.ts`:

```ts
import remarkWikiLink from './src/plugins/remark-wiki-link.js'

remarkWikiLink({
  format: 'shortestPossible',
  files: vaultFiles,
  permalinks,
  className: 'internal',
  newClassName: 'new'
})
```

### Options

| Option | Description | Default |
| --- | --- | --- |
| `format` | Use `shortestPossible` for Obsidian-style matching or `regular` for exact paths. | `shortestPossible` |
| `files` | Markdown/MDX file paths used to resolve links. | `[]` |
| `permalinks` | Maps file paths to custom URLs. | `{}` |
| `className` | Class added to resolved and unresolved links. | `internal` |
| `newClassName` | Class added when no matching file exists. | `new` |
| `urlResolver` | Custom function receiving `{ filePath, heading, isEmbed }`. | Built-in resolver |
| `caseInsensitive` | Enables case-insensitive file matching. | `true` |
| `aliasDivider` | Separates a target from its display text. | `|` |

`shortestPossible` matching compares the end of each file path and chooses the
shortest match. Use `regular` when exact path matching is required.

## Exports

The local module exports the same public helpers used by the upstream plugin:

- Default and named `remarkWikiLink` plugin
- `syntax`
- `fromMarkdown`
- `toMarkdown`
- `defaultUrlResolver`
- `findMatchingFilePath`

The `toMarkdown` extension preserves wiki-link syntax when Markdown trees are
stringified.

## Project integration

The plugin is used in two places:

1. `astro.config.ts` — parses wiki links while building Markdown and MDX pages.
2. `src/utils/graph.ts` — parses wiki links while generating vault graph and
   backlink relationships.

The project’s vault link resolver runs after this plugin to resolve assets,
relative paths, headings, and site-specific `/vault/...` URLs.

## Known limitations

- Ambiguous shortest-path matches resolve to the shortest matching path.
- Unresolved links still produce an HTML URL and are identified by a CSS class.
- Note embeds do not inject the note body into the current document.
- Media dimensions are exposed as data attributes rather than native HTML
  `width` and `height` attributes.
- This is a vendored implementation, so upstream fixes must be reviewed and
  merged manually.
- The implementation currently uses `@ts-nocheck` and has no standalone test
  suite; project builds and focused parser tests provide validation.

## Attribution

Original project: [flowershow/remark-wiki-link](https://github.com/flowershow/remark-wiki-link)

The original project is distributed under the MIT License. The local file
retains the upstream behavior and should continue to be treated as MIT-licensed
code.
