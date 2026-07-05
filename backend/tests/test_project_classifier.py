"""T1.7 — project type/nature classifier vs a hand-labeled set of 40 real
register names (labels assigned by reading each name, 2026-07-05).

Acceptance: ≥90% accuracy on confidently-classified rows and ZERO silent
wrong labels — anything uncertain must arrive flagged, never guessed.
"""

import pytest

from app.services.register_parsing import classify_project

# 28 clear-cut names → (type, nature). The classifier must be confident
# AND match the label on every one.
LABELED_CONFIDENT = [
    ("Construction of Mada - Wonaka - R/Bore Road", "road", "construction"),
    ("construction of K/Kwashi - Mada Road, 15km", "road", "construction"),
    ("Construction of Jalingo - Sunkani - Garba Chede Road", "road", "construction"),
    ("Dualization of Uyo - Etinan Road", "road", "dualization"),
    ("Dualization of Bauchi Ring Road", "road", "dualization"),
    ("Dualisation of Gada Biyu - Rukuba Satellite Market Road (1km)", "road", "dualization"),
    ("Rehabilitation of Katsina Ala - Zaki Biam - Ugba - Buruku Road in Benue State. Contract No: 508",
     "road", "rehabilitation"),
    ("Special Repairs of Jos - Gimi Road, Route 70 in Plateau State. Contract No: 023",
     "road", "rehabilitation"),
    ("General Maintenance Repair works along Lagos - Badagry - Seme border Dual Carriageway in Lagos State",
     "road", "maintenance"),
    ("Asphalting of Rimawa - S/Birni Road 62km", "road", "rehabilitation"),
    ("Contract for the Reconstuction of Mushi - Isolo Road in Mushin LGA, Lagos",
     "road", "rehabilitation"),
    ("Contract for the Recoonstruction of Road Network in Malamre ward in Yola",
     "road", "rehabilitation"),
    ("Scarification of Failed Sections Along Yola - Numan Road", "road", "rehabilitation"),
    ("Completion of Isa - Bafarawa road (Construction of Access Road to Government House)",
     "road", "completion"),
    ("Provision of Road Infrastructure to the Satellite Town of Karu", "road", "construction"),
    ("Rehabilitation of Suleja Township Roads", "road", "rehabilitation"),
    ("Construction of Roads & Bridges in Jalingo. Additional work for Sabon Gari",
     "road", "construction"),  # roads first → road job with bridges
    ("Construction of Romon Sarki - Romon Liman Bridge with 2km Approach",
     "bridge", "construction"),
    ("Offer for the completion of Upgrading & Rehabilitation of Akanu Ibiam Airport, Enugu",
     "airport", "completion"),
    ("Structural Repair & Partial Overlay of Kaduna Airport Runway 05/23 & Airfield Lighting (AFL) Works",
     "airport", "rehabilitation"),
    ("Emergency Remedial Works on Kaduna International Airport Runway",
     "airport", "emergency_repair"),
    ("Improvement of Minna & Kontagora Water Schemes", "water", "construction"),
    ("Construction of Mainland Collector Drains, Ebute Metta, Lagos, Mainland Local Government",
     "drainage", "construction"),
    ("Dredging of Otto Creek, Otto, Mainland Local Government Area.",
     "drainage", "rehabilitation"),
    ("Rehabilitation of Burnt Sokoto Central Market", "building", "rehabilitation"),
    ("Phase 3 Contract of the Comprehensive Renovation of House of Assembly",
     "building", "rehabilitation"),
    ("Rehabilitation of Aerators at Gudu, Mogadishu & Niger Barracks",
     "infrastructure", "rehabilitation"),
    ("Contract for the Rehabilitation of the Twin Jimeta Motor Park",
     "infrastructure", "rehabilitation"),
]

# 12 names where any confident answer would be a guess — the classifier
# MUST flag these (confident=False). This is the zero-silent-wrong rule.
MUST_FLAG = [
    "Old Bukuru Road",                                    # no work verb
    "Rikkos - Yan Shanu road",
    "Zaria Cresent",
    "Mangu Bye-pass road (13km)",
    "Zuba - Abaji Road. Contract No: CN 3196",
    "Taraba Local Government Roads (10 LGC's)",
    "Kpantinapu Bridge with Approach Roads",              # bridge, no verb
    "Mayo Gwoi Bridge & Approaches",
    "Construction of Kware - Salame - Gada",              # verb, no asset type
    "Earthwork Conveyor Belt",
    "Carlton Estate Civil & Cold Water Pipe Work",
    "Compensation for Land / Properties & Relocation of Dention Police Station",
]


class TestLabeledAccuracy:
    def test_confident_and_correct_on_all_labeled_rows(self):
        """Stronger than the ≥90% acceptance bar: every clear-cut name must
        be confidently AND correctly classified."""
        failures = []
        for name, exp_type, exp_nature in LABELED_CONFIDENT:
            c = classify_project(name)
            if not c.confident:
                failures.append(f"NOT CONFIDENT: {name[:60]}")
            elif (c.project_type, c.work_nature) != (exp_type, exp_nature):
                failures.append(
                    f"WRONG: {name[:50]} → ({c.project_type},{c.work_nature}) "
                    f"expected ({exp_type},{exp_nature})"
                )
        accuracy = 1 - len(failures) / len(LABELED_CONFIDENT)
        assert not failures, f"accuracy {accuracy:.0%}\n" + "\n".join(failures)

    @pytest.mark.parametrize("name", MUST_FLAG)
    def test_uncertain_names_are_flagged_never_guessed(self, name):
        c = classify_project(name)
        assert not c.confident, (
            f"silently classified as ({c.project_type},{c.work_nature}) — "
            "uncertainty must flag, never guess"
        )
        assert c.needs_review

    def test_labeled_set_size_is_40(self):
        assert len(LABELED_CONFIDENT) + len(MUST_FLAG) == 40


class TestClassifierContract:
    def test_outputs_always_within_taxonomy(self):
        from app.services.register_parsing import PROJECT_TYPES, WORK_NATURES

        for name, *_ in LABELED_CONFIDENT + [(n,) for n in MUST_FLAG]:
            c = classify_project(name)
            assert c.project_type in PROJECT_TYPES
            assert c.work_nature in WORK_NATURES

    def test_never_raises_on_hostile_input(self):
        for hostile in (None, "", 42, object(), ["x"], b"bytes"):
            c = classify_project(hostile)
            assert c.project_type == "other" or isinstance(c.project_type, str)

    def test_airport_road_is_a_road_not_an_airport(self):
        c = classify_project("Dualization of Old Airport Road - Rayfield - Government House")
        assert c.project_type == "road"
