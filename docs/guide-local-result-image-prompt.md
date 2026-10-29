# Ảnh hướng dẫn copy kết quả local

Tool: built-in ImageGen, edit mode.

Source: ảnh Terminal macOS do người dùng cung cấp.

Asset: `public/guides/inf1003/hinh-copy-ket-qua-local-annotated.png`.

## Prompt macOS

Use case: precise-object-edit.
Edit target: the provided screenshot of a macOS Terminal, 1196 x 814 pixels. This is a website instructional screenshot.
Preserve the screenshot, terminal window, fonts, background and ALL existing terminal text exactly, especially all five wrapped lines of the long BDU-LAB-V1: Base64 result. Do not retype or alter the token. Only add clear instructional annotations on top of the existing screenshot.
Add a bright red rectangular outline (4 px stroke, no fill) around the complete result token region: roughly x=23..1162, y=524..664, including all five lines from BDU-LAB-V1: through the final T1MT0NBTAo=. Exclude the ===== separators.
Above this rectangle, in the free dark space on the RIGHT, put a legible red rounded callout with white bold Vietnamese text exactly: "Copy dòng này". Add a red arrow from this callout pointing downward to the top edge of the highlighted token. Do not cover the result text with arrow or callout.
The old two-line footer at y=693..744 says to import lab-result.json, which is obsolete. Cover ONLY those two footer lines with matching dark terminal background and replace them with white monospace Vietnamese text: "Copy toàn bộ chuỗi trong khung đỏ, dán vào ô cuối bước 2." Keep the shell prompt at the bottom unchanged.
Do not add extra UI or other instructions. Keep the full window in frame, same aspect ratio. This is an annotated screenshot, not an artistic recreation.

## Windows

Tool: built-in ImageGen, edit mode.

Asset: `public/guides/inf1003/hinh-copy-ket-qua-windows-annotated.png`.

### Prompt

Use case: precise-object-edit. Edit target: the provided Windows PowerShell screenshot, 999 x 523 pixels, for a Vietnamese website tutorial.
Preserve the entire screenshot and all text as closely as possible, especially the complete BDU-LAB-V1: token. Do not rewrite terminal output. Add only tutorial annotations.
Draw a bright red unfilled rectangular outline, about 3 pixels wide at original image scale, around ALL the wrapped token lines near the bottom. The token region is x=7 to 973, y=403 to 469: start at BDU-LAB-V1: on the first line and include the last short wrapped line ending ==. Exclude the ==== separators above and below. Never hide token text under annotation.
In the large EMPTY BLACK area on the RIGHT above the token, roughly x=650..945 and y=330..375, add a red rounded callout with bold white Vietnamese text exactly "Copy dòng này". Add a red arrow from the callout pointing down toward the upper edge of the token rectangle, stopping outside the token so no characters are covered.
Keep the recognizable Windows PowerShell title bar, existing footer instruction to copy the token and Windows prompt intact. Same full screenshot, same aspect ratio. No other added text or UI, no artistic recreation.
