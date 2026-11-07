"""Regenerate the synthetic PDF search fixtures.

Install reportlab, pikepdf, and fonttools for regeneration. The fixtures
were produced with ReportLab 5.1.0, pikepdf 10.17.0, FontTools 4.68.0,
and Chrome 156.0.8078.81.

Pass the Chrome/Chromium executable and these two upstream font files:

* Noto Sans CJK KR Regular, Sans2.004 (SIL OFL 1.1):
  https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf
  https://github.com/notofonts/noto-cjk/blob/Sans2.004/LICENSE
* Noto Sans Regular, v20201206-phase3 (SIL OFL 1.1):
  https://github.com/notofonts/noto-fonts/blob/v20201206-phase3/hinted/ttf/NotoSans/NotoSans-Regular.ttf
  https://github.com/notofonts/noto-fonts/blob/v20201206-phase3/LICENSE

Only subsets are embedded in the PDFs. The cid-* fixtures reference
Helvetica and the predefined Adobe-Korea1 font without embedding them.
All document text is synthetic.
"""

import argparse
import hashlib
from html import escape
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory

import pikepdf
from fontTools import subset
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas


CJK_SHA256 = "6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a"
LATIN_SHA256 = "dac8e68fe43fca59d522fa5f763322cfb4a919c28957656c58e7836d915307d0"
FIXTURE_OWNER = "inkacre-fixture-owner"
FIXTURE_OPEN = "inkacre-fixture-open"


def check_font(font, expected):
    if hashlib.sha256(font.read_bytes()).hexdigest() != expected:
        raise ValueError(f"Font digest does not match the documented upstream file: {font}")


def make_chromium(folder, chrome, font, latin):
    heading = "견적서 Estimate"
    paragraphs = (
        ("ko", "프로젝트 예산은 삼천만 원이며 일정은 두 달입니다."),
        ("en", "ligatures: office efficient."),
        ("ko", "개발 2,000,000"),
        ("ja", "日本語の文章もあります。"),
    )
    text = " ".join([heading, *(line for _, line in paragraphs)])
    for source, target in ((font, "fixture.otf"), (latin, "fixture-latin.ttf")):
        # Keep only the fixture's code points so Chrome's ToUnicode map
        # does not choose an unused compatibility character for a shared glyph.
        options = subset.Options()
        options.name_IDs = ["*"]
        glyphs = subset.Subsetter(options=options)
        glyphs.populate(text=text)
        with subset.load_font(source, options) as face:
            glyphs.subset(face)
            subset.save_font(face, folder / target, options)

    html = folder / "fixture.html"
    html.write_text(
        """<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<title>Inkacre synthetic estimate</title>
<style>
@font-face { font-family: Fixture; src: url(fixture.otf); }
@font-face { font-family: FixtureLatin; src: url(fixture-latin.ttf); }
@page { size: A4; margin: 25mm; }
body { font: 14px Fixture; }
p[lang="en"] { font-family: FixtureLatin; }
h1 { font-size: 23px; font-weight: normal; }
</style>
"""
        + f"<h1>{escape(heading)}</h1>\n"
        + "\n".join(f'<p lang="{lang}">{escape(line)}</p>' for lang, line in paragraphs),
        encoding="utf-8",
    )
    subprocess.run(
        [
            chrome,
            "--headless",
            "--disable-background-networking",
            "--disable-component-update",
            "--no-first-run",
            "--no-pdf-header-footer",
            "--allow-file-access-from-files",
            "--virtual-time-budget=1500",
            f"--user-data-dir={folder / 'chrome-profile'}",
            f"--print-to-pdf={folder / 'chromium.pdf'}",
            html.as_uri(),
        ],
        check=True,
        timeout=60,
    )


def make_cid(output):
    pdfmetrics.registerFont(UnicodeCIDFont("HYSMyeongJo-Medium"))
    pdf = Canvas(str(output), invariant=1)
    pdf.setTitle("Inkacre synthetic quarterly report")
    pdf.setFont("Helvetica", 12)
    pdf.drawString(54, 779, "Quarterly report: revenue grew 12% (Helvetica)")
    pdf.setFont("HYSMyeongJo-Medium", 12)
    pdf.drawString(54, 747, "분기 보고서 — 매출이 증가했습니다")
    pdf.drawString(54, 726, "두 번째 줄의 한국어 문장")
    pdf.showPage()
    pdf.setFont("Helvetica", 12)
    pdf.drawString(54, 779, "Second page")
    pdf.save()


def make_embedded(output, font):
    pdfmetrics.registerFont(TTFont("FixtureSans", str(font)))
    pdf = Canvas(str(output), invariant=1)
    pdf.setTitle("Inkacre synthetic embedded font")
    text = pdf.beginText(54, 779)
    text.setFont("FixtureSans", 12)
    text.textLine("Embedded subset font: café naïve “quotes” — dash")
    text.textLine("Line one of a text object")
    text.textLine("Line two after T*")
    pdf.drawText(text)
    pdf.save()


def encrypt(source, output, revision, password="", *, object_streams=False):
    with pikepdf.Pdf.open(source) as pdf:
        pdf.save(
            output,
            encryption=pikepdf.Encryption(
                owner=FIXTURE_OWNER,
                user=password,
                R=revision,
                aes=revision >= 4,
                metadata=revision >= 4,
            ),
            object_stream_mode=(
                pikepdf.ObjectStreamMode.generate
                if object_streams
                else pikepdf.ObjectStreamMode.disable
            ),
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chrome", required=True, type=Path)
    parser.add_argument("--noto-cjk", required=True, type=Path)
    parser.add_argument("--noto-sans", required=True, type=Path)
    args = parser.parse_args()
    check_font(args.noto_cjk, CJK_SHA256)
    check_font(args.noto_sans, LATIN_SHA256)

    with TemporaryDirectory(prefix="inkacre-fixtures-") as temporary:
        folder = Path(temporary)
        make_chromium(folder, args.chrome, args.noto_cjk, args.noto_sans)
        cid = folder / "cid-source.pdf"
        make_cid(cid)
        encrypt(cid, folder / "cid-aes256.pdf", 6)
        encrypt(cid, folder / "cid-rc4.pdf", 3)
        encrypt(cid, folder / "cid-password.pdf", 6, FIXTURE_OPEN)
        embedded = folder / "ttf-source.pdf"
        make_embedded(embedded, args.noto_sans)
        encrypt(embedded, folder / "ttf-aes128-objstm.pdf", 4, object_streams=True)

        for name in (
            "chromium.pdf",
            "cid-aes256.pdf",
            "cid-rc4.pdf",
            "cid-password.pdf",
            "ttf-aes128-objstm.pdf",
        ):
            shutil.copyfile(folder / name, Path(__file__).with_name(name))


if __name__ == "__main__":
    main()
