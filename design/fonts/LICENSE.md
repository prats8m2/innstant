# Font licences

All three families are Google Fonts released under the **SIL Open Font License
1.1**, which permits commercial use, embedding and self-hosting. A hotel
deployment is commercial use, so this matters — checked before shipping, per
`design/README.md`.

| Family | Files | Licence | Upstream |
|---|---|---|---|
| Marcellus | `marcellus-400.woff2` | SIL OFL 1.1 | https://fonts.google.com/specimen/Marcellus |
| Mukta | `mukta-400/500/600/700.woff2` | SIL OFL 1.1 | https://fonts.google.com/specimen/Mukta |
| DM Mono | `dm-mono-400/500.woff2` | SIL OFL 1.1 | https://fonts.google.com/specimen/DM+Mono |

The woff2 files were extracted from the Claude Design export
(`pnpm design:decode`), which embedded the Google Fonts subsets. They are the
**latin** subsets — the largest per family/weight in the export. If a property
ever needs Devanagari (Mukta covers it upstream), pull the fuller subset from
Google Fonts rather than re-extracting.

SIL OFL 1.1 requires that the licence accompany the fonts. Full text:
https://openfontlicense.org/
