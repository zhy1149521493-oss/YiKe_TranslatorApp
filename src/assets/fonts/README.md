# Offline interface fonts

The connected desktop interface and independent design demo share the unmodified variable fonts used by the HTML references:

- [Noto Serif SC](https://github.com/google/fonts/tree/main/ofl/notoserifsc), `NotoSerifSC[wght].ttf`; see [its SIL Open Font License](NotoSerifSC-OFL.txt).
- [Inter](https://github.com/google/fonts/tree/main/ofl/inter), `Inter[opsz,wght].ttf`; see [its SIL Open Font License](Inter-OFL.txt).

Downloaded from the Google Fonts repository. These files are loaded locally; the interface does not contact Google Fonts. The complete fonts total approximately 26 MB, retaining arbitrary Chinese input rather than limiting characters to the fixtures. Both production and Demo builds include these shared assets. Retaining complete character coverage supports arbitrary Chinese text. The local candidate deliberately retains the full fonts (approximately 26 MB); compression/subsetting is a later optimization requiring visual checks. Their OFL notices are included in `public/licenses/` and packaged with the candidate.
