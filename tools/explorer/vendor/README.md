# Offline Markdown renderer bundle

The explorer embeds Marked 18.2.1, DOMPurify 3.4.18 and Mermaid 12.3.0. The
browser bundle was built with esbuild 0.27.4, platform browser, target ES2022,
IIFE format, global name GolemMarkdown, minification and inline legal comments.
`entry.mjs` is its complete entry point. `manifest.json` pins direct versions
and verifies compressed/uncompressed SHA-256. Third-party license notices are
retained here and embedded in the generated HTML.

The gzip stream is deterministic (`gzip.compress(..., compresslevel=9, mtime=0)`)
and inlined as base64 by the standard-library Python generator. Native browser
DecompressionStream loads this trusted local bundle; no CDN, server, package
installation, font or external script is used when opening the HTML. Use a
current Chrome, Edge, Firefox or Safari with DecompressionStream support.

To rebuild, install the three pinned direct dependencies and esbuild in a
temporary build directory, copy entry.mjs there, then run:

```sh
esbuild entry.mjs --bundle --format=iife --global-name=GolemMarkdown --platform=browser --target=es2022 --minify --legal-comments=inline --outfile=markdown.bundle.js
```

Compress with the deterministic settings above, update both manifest hashes,
retain notices for the included dependency tree, and rerun renderer tests.
The engine supports Mermaid diagram types bundled by that pinned release;
images/fonts hosted externally are deliberately not loaded from documents.
