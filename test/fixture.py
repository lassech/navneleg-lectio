"""Bygger en helt opdigtet test-udgave af Lectios side "Lærere og elever".

Siden efterligner kun HTML-strukturen (tabel-id, kolonner, data-lectiocontextcard,
GetImage.aspx-billeder), som udvidelsen læser. Alle navne, ID'er og billeder er
fiktive. Skriver members.html, members_one.html, members_empty.html og mapping.json.

Kør: python3 fixture.py <ud-mappe>
"""
import html
import json
import sys
from pathlib import Path

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
HOLD_ID = "123456789"

# 30 fiktive elever: dansk sortering (Æ Ø Å sidst), accent, to med samme fornavn,
# dobbelt fornavn. Tre af dem har intet foto (defaultfoto).
NAMES = [
    ("Åse", "Holm"), ("Bo", "Nielsen"), ("Clara", "Berg"), ("Davud", "Yilmaz"),
    ("Emma", "Hansen"), ("Freja", "Lund"), ("Gustav", "Mørk"), ("Hanna", "Krog"),
    ("Ida", "Vestergaard"), ("Jonas", "Friis"), ("Karla", "Dahl"), ("Lukas", "Bach"),
    ("Maja", "Skov"), ("Noah", "Juhl"), ("Olivia", "Kjær"), ("Peter", "Toft"),
    ("Rasmus", "Bjerre"), ("Sofie", "Lind"), ("Theo", "Brink"), ("Ulla", "Winther"),
    ("Viktor", "Ravn"), ("Zoë", "Andersen"), ("Ærø", "Pedersen"), ("Øjvind", "Storm"),
    ("Anna Marie", "Bruun"), ("Emma", "Jensen"), ("Xenia", "Olsen"),
    ("Yasmin", "Ali"), ("Mikkel", "Thorsen"), ("Line", "Fog"),
]
NO_PHOTO = {10, 15, 20}  # indeks i NAMES uden foto (Karla, Peter, Viktor)

PAGE = """<!DOCTYPE html>
<html lang="da"><head><meta charset="utf-8">
<title>Holdet 1x Test - Lærere og elever - Lectio - Testskolen</title>
<style>
 body {{ font: 13px Arial, sans-serif; margin: 0; }}
 header {{ background: #1f3c5c; color: #fff; padding: 10px 16px; font-size: 18px; }}
 main {{ padding: 12px 16px; }}
 table {{ border-collapse: collapse; }} td, th {{ border: 1px solid #ccc; padding: 2px 6px; }}
 nav.bottom {{ position: fixed; bottom: 0; left: 0; right: 0; background: #1f3c5c; color: #fff; padding: 8px; z-index: 1000; }}
</style></head>
<body>
<form method="post" action="./members.aspx?holdelementid={hold}" id="aspnetForm">
<header>Testskolen · Lectio (fiktiv testside)</header>
<main>
<h1>Holdet 1x Test - Lærere og elever</h1>
<div class="submenu"><a class="aspNetDisabled">Alm. m/billeder</a> <a href="#">Afkrydsningsliste</a></div>
<div id="printlistarea"><div id="s_m_Content_Content_list">
{table}
</div></div>
</main>
<nav class="bottom">Forside · Skema · Beskeder</nav>
</form>
</body></html>
"""


def img_tag(ctl, src):
    return (f'<img id="s_m_Content_Content_laerereleverpanel_alm_gv_ctl{ctl:02d}_Thumbview1thumbimage" '
            f'title="Vis større foto" src="{src}" alt="" '
            f'onclick="return false;">')


def row(ctl, card, typ, short_id, fornavn, efternavn, src):
    link = "laererid" if typ == "Lærer" else "elevid"
    return f"""<tr>
<td data-lectiocontextcard="{card}">{img_tag(ctl, src)}</td><td>{typ}</td>
<td class="smallCol" data-lectiocontextcard="{card}"><span class="noWrap">{short_id}</span></td>
<td class="largeCol printUpscaleFontFornavn" data-lectiocontextcard="{card}"><span class="noWrap">
<a href="/lectio/76/SkemaNy.aspx?{link}={card[1:]}">{html.escape(fornavn)} </a></span></td>
<td class="largeCol" data-lectiocontextcard="{card}"><span class="noWrap">{html.escape(efternavn)} </span></td>
<td class="nowrap"></td>
</tr>"""


def table(rows):
    head = ('<tr class=" "><th scope="col">Foto</th><th scope="col"><a>Type</a></th><th scope="col"><a>ID</a></th>'
            '<th scope="col"><a>Fornavn</a></th><th scope="col"><a>Efternavn</a></th><th scope="col">Hold</th></tr>')
    return ('<div class="ls-table-wrapper"><table class="ls-table-layout2 lf-grid" '
            'id="s_m_Content_Content_laerereleverpanel_alm_gv"><tbody>' + head + "".join(rows) + "</tbody></table></div>")


mapping = {}
teacher = row(2, "T900000001", "Lærer", "TL", "Test", "Lærer", "/lectio/76/GetImage.aspx?pictureid=900")
students = []
for k, (fornavn, efternavn) in enumerate(NAMES):
    pid = 1000 + k
    card = f"S{800000000 + k}"
    if k in NO_PHOTO:
        src = "/lectio/img/defaultfoto_small.jpg"
    else:
        # Halvdelen med "&fullsize=3" (skal erstattes), resten uden (skal tilføjes)
        src = f"/lectio/76/GetImage.aspx?pictureid={pid}" + ("&amp;fullsize=3" if pid % 2 else "")
    students.append(row(k + 3, card, "Elev", f"1x {k + 1:02d}", fornavn, efternavn, src))
    mapping[str(pid)] = {"fornavn": fornavn, "efternavn": efternavn, "card": card, "foto": k not in NO_PHOTO}

(OUT / "members.html").write_text(PAGE.format(hold=HOLD_ID, table=table([teacher] + students)), encoding="utf-8")
first_photo = next(s for k, s in enumerate(students) if k not in NO_PHOTO)
(OUT / "members_one.html").write_text(PAGE.format(hold="one", table=table([teacher, first_photo])), encoding="utf-8")
(OUT / "members_empty.html").write_text(PAGE.format(hold="empty", table="<p>Ingen medlemmer</p>"), encoding="utf-8")
(OUT / "mapping.json").write_text(json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")
print("fixtures ok:", sum(v["foto"] for v in mapping.values()), "med foto,",
      sum(not v["foto"] for v in mapping.values()), "uden")
