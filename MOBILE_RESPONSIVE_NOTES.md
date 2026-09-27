# Mobile responsive update

The refreshed console now uses a left off-canvas sidebar below 768px. On phones:

- tap the menu button in the header to open navigation;
- tap X or the backdrop to close it;
- navigation never moves above the page content;
- the global search stays inside the header and uses a 16px input on iOS to avoid Safari focus zoom;
- `type=search` native Safari decoration is reset so the search field keeps the Web Blast visual style;
- viewport safe-area support is enabled for modern iPhone devices.

For Node 24 testing, no source build step is required for this CSS-only responsive update; the generated `public/css/app.css` is already updated.
