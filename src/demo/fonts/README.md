# Offline preview fonts

The design demo ships the unmodified variable fonts used by the HTML references:

- [Noto Serif SC](https://github.com/google/fonts/tree/main/ofl/notoserifsc), `NotoSerifSC[wght].ttf`; see [its SIL Open Font License](NotoSerifSC-OFL.txt).
- [Inter](https://github.com/google/fonts/tree/main/ofl/inter), `Inter[opsz,wght].ttf`; see [its SIL Open Font License](Inter-OFL.txt).

Downloaded from the Google Fonts repository. These files are loaded locally; the demo does not contact Google Fonts. The complete fonts total approximately 26 MB, retaining arbitrary Chinese input rather than limiting characters to the fixtures. They are referenced only by the demo entry, so the production app build does not include them. Font compression/subsetting for a production integration is deferred until visual acceptance.
