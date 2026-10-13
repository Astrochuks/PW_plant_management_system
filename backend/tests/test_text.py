"""House Title Case — golden cases. The TypeScript twin (lib/format.ts
titleCase) is checked against the same table by scripts/check_title_case.mjs
(node); keep GOLDEN in sync with that file."""

import pytest

from app.core.text import title_case

GOLDEN = [
    ("CONSTRUCTION OF MARU - LUGGA ROAD & 2 NO. BRIDGES, 2-SPAN (36M) & 15-SPAN (270M) IN MARU LGA ",
     "Construction of Maru - Lugga Road & 2 No. Bridges, 2-Span (36m) & 15-Span (270m) in Maru LGA"),
    ("PROPOSED CONSTRUCTION OF 15 SPAN, DUAL CARRIAGEWAY, 6TH BRIDGE OVER RIVER KADUNA AND APPROACH ROADS",
     "Proposed Construction of 15 Span, Dual Carriageway, 6th Bridge over River Kaduna and Approach Roads"),
    ("CONSTRUCTION OF 16.5KM ASPHALTIC ROAD FROM KAYARDA TASHA – KAYARDA GARI – U/SARKI – MASKAWA – DAN ALHAJI ROAD, LERE LGA, KADUNA STATE.",
     "Construction of 16.5km Asphaltic Road from Kayarda Tasha – Kayarda Gari – U/Sarki – Maskawa – Dan Alhaji Road, Lere LGA, Kaduna State."),
    ("CONSTRUCTION OF GUSAU – MAGAMI – DANSADAU ROAD, STAGE 2/(LOT2) COVERING 43KM (CH30 + 000 – CH65 + 000). ",
     "Construction of Gusau – Magami – Dansadau Road, Stage 2/(Lot2) Covering 43km (Ch30 + 000 – Ch65 + 000)."),
    ("REHABILITATION OF UTONKON - NUNKU & KEANA LINKS WITH EXTENSION OF AKILA MACHUNGA ROAD & CONSTRUCTION OF A 9 (NINE) SPAN FLYOVER BRIDGE AT ABBATOIR.",
     "Rehabilitation of Utonkon - Nunku & Keana Links with Extension of Akila Machunga Road & Construction of a 9 (Nine) Span Flyover Bridge at Abbatoir."),
    ("DUALIZATION OF OLD AIRPORT ROAD JUNCTION - RAYFIELD - BUKURU, NEW GOVERNMENT HOUSE LOOP WITH SPUR TO UMA BREAD (CHONG'O'PYENG & ABBATOIR - DOGON KARFE ROAD",
     "Dualization of Old Airport Road Junction - Rayfield - Bukuru, New Government House Loop with Spur to Uma Bread (Chong'o'pyeng & Abbatoir - Dogon Karfe Road"),
    ("The construction of Kuba - Tenti - Manguna - Daffo - Road with spur from Tadai Junction - Hurti - Josho - Daffo Road (81km) ",
     "The Construction of Kuba - Tenti - Manguna - Daffo - Road with Spur from Tadai Junction - Hurti - Josho - Daffo Road (81km)"),
    (" GWANTU TOWHSHIP ROADS", "Gwantu Towhship Roads"),
    ("GOVERNMENT OF AKWA IBOM STATE, MINISTRY OF SPECIAL DUTIES", "Government of Akwa Ibom State, Ministry of Special Duties"),
    ("NURUS-SIRAJ NIGERIA LIMITED", "Nurus-Siraj Nigeria Limited"),
    ("FERMA", "FERMA"),
    ("CONSTRUCTION OF KRPC - SABON TASHA ROAD", "Construction of KRPC - Sabon Tasha Road"),
    ("ROAD IN FCT", "Road in FCT"),
    ("OF THE PEOPLE", "Of the People"),              # a small word opening the name is capitalised
    ("", ""), ("   ", ""),
]


@pytest.mark.parametrize("raw,expected", GOLDEN)
def test_house_title_case(raw, expected):
    assert title_case(raw) == expected


def test_none_passes_through():
    assert title_case(None) is None


def test_idempotent():
    for _, expected in GOLDEN:
        assert title_case(expected) == expected
