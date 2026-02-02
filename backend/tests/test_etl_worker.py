"""Tests for ETL worker processing logic.

Tests cover:
- Column name case-insensitivity (uppercase, lowercase, mixed)
- Physical verification logic (P/O values, remarks fallback)
- Usage data extraction (hours_worked, standby_hours, breakdown_hours)
- Fleet number normalization
- Hours and off-hire parsing
"""

import pandas as pd
import pytest

from app.workers.etl_worker import (
    WEEKLY_COLUMN_MAP,
    derive_physical_verification,
    map_columns,
    normalize_fleet_number,
    parse_hours,
    parse_off_hire,
)


class TestMapColumns:
    """Tests for column mapping with case variations."""

    def test_lowercase_columns(self):
        """Column names in lowercase should map correctly."""
        df = pd.DataFrame({
            "fleet no": ["PW 001"],
            "hours worked": [40],
            "s/b hour": [8],
            "b/d hour": [2],
            "physical verification": ["P"],
            "remarks": ["Good condition"],
        })

        result = map_columns(df, WEEKLY_COLUMN_MAP)

        assert "fleet_number" in result.columns
        assert "hours_worked" in result.columns
        assert "standby_hours" in result.columns
        assert "breakdown_hours" in result.columns
        assert "physical_verification" in result.columns
        assert "remarks" in result.columns

    def test_uppercase_columns(self):
        """Column names in UPPERCASE should map correctly."""
        df = pd.DataFrame({
            "FLEET NO": ["PW 001"],
            "HOURS WORKED": [40],
            "S/B HOUR": [8],
            "B/D HOUR": [2],
            "PHYSICAL VERIFICATION": ["P"],
            "REMARKS": ["All good"],
        })

        result = map_columns(df, WEEKLY_COLUMN_MAP)

        assert "fleet_number" in result.columns
        assert "hours_worked" in result.columns
        assert "standby_hours" in result.columns
        assert "breakdown_hours" in result.columns
        assert "physical_verification" in result.columns
        assert "remarks" in result.columns

    def test_mixed_case_columns(self):
        """Column names in Mixed Case should map correctly."""
        df = pd.DataFrame({
            "Fleet No": ["PW 001"],
            "Hours Worked": [40],
            "S/B Hour": [8],
            "B/D Hour": [2],
            "Physical Verification": ["P"],
            "Remarks": ["OK"],
        })

        result = map_columns(df, WEEKLY_COLUMN_MAP)

        assert "fleet_number" in result.columns
        assert "hours_worked" in result.columns
        assert "standby_hours" in result.columns
        assert "breakdown_hours" in result.columns
        assert "physical_verification" in result.columns
        assert "remarks" in result.columns

    def test_columns_with_whitespace(self):
        """Column names with extra whitespace should map correctly."""
        df = pd.DataFrame({
            " fleet no ": ["PW 001"],
            "  hours worked  ": [40],
        })

        result = map_columns(df, WEEKLY_COLUMN_MAP)

        assert "fleet_number" in result.columns
        assert "hours_worked" in result.columns

    def test_alternative_column_names(self):
        """Alternative column name variations should map correctly."""
        # Test different variants from the column map
        df = pd.DataFrame({
            "fleet number": ["PW 001"],
            "working hours": [40],
            "standby hours": [8],
            "breakdown hours": [2],
            "ppv": ["P"],
            "remark": ["Fine"],
        })

        result = map_columns(df, WEEKLY_COLUMN_MAP)

        assert "fleet_number" in result.columns
        assert "hours_worked" in result.columns
        assert "standby_hours" in result.columns
        assert "breakdown_hours" in result.columns
        assert "physical_verification" in result.columns
        assert "remarks" in result.columns


class TestPhysicalVerification:
    """Tests for physical verification derivation logic."""

    def test_p_value_returns_true(self):
        """'P' value in physical verification column should return True."""
        assert derive_physical_verification("P", None) is True
        assert derive_physical_verification("p", None) is True
        assert derive_physical_verification(" P ", None) is True

    def test_o_value_returns_false(self):
        """'O' value in physical verification column should return False."""
        assert derive_physical_verification("O", None) is False
        assert derive_physical_verification("o", None) is False
        assert derive_physical_verification(" O ", None) is False

    def test_other_true_values(self):
        """Other common 'verified' values should return True."""
        assert derive_physical_verification("yes", None) is True
        assert derive_physical_verification("YES", None) is True
        assert derive_physical_verification("true", None) is True
        assert derive_physical_verification("1", None) is True
        assert derive_physical_verification("verified", None) is True
        assert derive_physical_verification("present", None) is True

    def test_other_false_values(self):
        """Other common 'not verified' values should return False."""
        assert derive_physical_verification("no", None) is False
        assert derive_physical_verification("NO", None) is False
        assert derive_physical_verification("false", None) is False
        assert derive_physical_verification("0", None) is False
        assert derive_physical_verification("absent", None) is False

    def test_empty_column_with_not_seen_remarks(self):
        """Empty column with 'not seen' in remarks should return False."""
        assert derive_physical_verification(None, "Not seen in yard") is False
        assert derive_physical_verification(None, "NOT SEEN") is False
        assert derive_physical_verification(None, "Plant not found") is False
        assert derive_physical_verification(None, "missing from site") is False
        assert derive_physical_verification(None, "unavailable") is False

    def test_empty_column_with_normal_remarks(self):
        """Empty column with normal remarks should return True (default)."""
        assert derive_physical_verification(None, "Good condition") is True
        assert derive_physical_verification(None, "Working fine") is True
        assert derive_physical_verification(None, "Operational") is True
        assert derive_physical_verification(None, "") is True

    def test_empty_column_and_remarks(self):
        """Both column and remarks empty should return True (default)."""
        assert derive_physical_verification(None, None) is True
        assert derive_physical_verification(pd.NA, pd.NA) is True

    def test_remarks_with_whitespace_variations(self):
        """Remarks with various whitespace should still be detected."""
        # "not seen" with extra spaces should still be detected
        assert derive_physical_verification(None, "not   seen") is False
        assert derive_physical_verification(None, "NOT\tSEEN") is False
        assert derive_physical_verification(None, "  not seen  ") is False

    def test_column_value_takes_precedence(self):
        """Column value should take precedence over remarks."""
        # Even if remarks say "not seen", if column is "P", it's verified
        assert derive_physical_verification("P", "not seen") is True
        # If column is "O", it's not verified even if remarks are positive
        assert derive_physical_verification("O", "Working perfectly") is False


class TestFleetNumberNormalization:
    """Tests for fleet number normalization."""

    def test_basic_normalization(self):
        """Basic fleet numbers should normalize correctly."""
        assert normalize_fleet_number("PW 001") == "PW 001"
        assert normalize_fleet_number("pw 001") == "PW 001"
        assert normalize_fleet_number("PW001") == "PW001"

    def test_removes_common_prefixes(self):
        """Common prefixes should be stripped."""
        assert normalize_fleet_number("Fleet No: PW 001") == "PW 001"
        assert normalize_fleet_number("Fleet No. PW 002") == "PW 002"
        assert normalize_fleet_number("No. PW 003") == "PW 003"

    def test_handles_whitespace(self):
        """Extra whitespace should be normalized."""
        assert normalize_fleet_number("  PW 001  ") == "PW 001"
        assert normalize_fleet_number("PW  001") == "PW 001"  # Multiple spaces to single

    def test_invalid_values_return_none(self):
        """Invalid values should return None."""
        assert normalize_fleet_number(None) is None
        assert normalize_fleet_number(pd.NA) is None
        assert normalize_fleet_number("") is None
        assert normalize_fleet_number("N/A") is None
        assert normalize_fleet_number("-") is None
        assert normalize_fleet_number("A") is None  # Too short


class TestParseHours:
    """Tests for hours parsing."""

    def test_numeric_values(self):
        """Numeric values should parse directly."""
        assert parse_hours(40) == 40.0
        assert parse_hours(40.5) == 40.5
        assert parse_hours(0) == 0.0

    def test_string_values(self):
        """String values should parse correctly."""
        assert parse_hours("40") == 40.0
        assert parse_hours("40.5") == 40.5
        assert parse_hours(" 40 ") == 40.0

    def test_values_with_units(self):
        """Values with hour suffixes should parse correctly."""
        assert parse_hours("40hrs") == 40.0
        assert parse_hours("40 hrs") == 40.0
        assert parse_hours("40hr") == 40.0
        assert parse_hours("40h") == 40.0

    def test_invalid_values_return_zero(self):
        """Invalid/missing values should return 0."""
        assert parse_hours(None) == 0.0
        assert parse_hours(pd.NA) == 0.0
        assert parse_hours("") == 0.0
        assert parse_hours("-") == 0.0
        assert parse_hours("N/A") == 0.0
        assert parse_hours("abc") == 0.0

    def test_negative_values_become_zero(self):
        """Negative values should become 0 (invalid hours)."""
        assert parse_hours(-5) == 0.0
        assert parse_hours("-10") == 0.0


class TestParseOffHire:
    """Tests for off-hire status parsing."""

    def test_true_values(self):
        """Values indicating off-hire should return True."""
        assert parse_off_hire("yes") is True
        assert parse_off_hire("YES") is True
        assert parse_off_hire("Y") is True
        assert parse_off_hire("y") is True
        assert parse_off_hire("true") is True
        assert parse_off_hire("1") is True
        assert parse_off_hire("x") is True
        assert parse_off_hire("off") is True

    def test_false_values(self):
        """Values not indicating off-hire should return False."""
        assert parse_off_hire("no") is False
        assert parse_off_hire("NO") is False
        assert parse_off_hire("N") is False
        assert parse_off_hire("false") is False
        assert parse_off_hire("0") is False
        assert parse_off_hire("") is False

    def test_missing_values(self):
        """Missing values should return False (default: not off-hire)."""
        assert parse_off_hire(None) is False
        assert parse_off_hire(pd.NA) is False


class TestIntegrationScenarios:
    """Integration tests simulating real Excel data scenarios."""

    def test_full_weekly_report_row_processing(self):
        """Simulate processing a complete row from a weekly report."""
        # Create DataFrame similar to real Excel data
        df = pd.DataFrame({
            "S/N": [1, 2, 3, 4, 5],
            "FLEET NO": ["PW 001", "PW 002", "PW 003", "PW 004", "PW 005"],
            "EQUIPMENT DESCRIPTION": ["CAT Excavator", "Komatsu Dozer", "Volvo Loader", "Hitachi Crane", "JCB Backhoe"],
            "PHYSICAL VERIFICATION": ["P", "P", "O", None, "P"],
            "HOURS WORKED": [40, 35, 0, 20, 45],
            "S/B HOUR": [8, 10, 0, 5, 0],
            "B/D HOUR": [0, 3, 48, 0, 2],
            "OFF HIRE": ["No", "No", "Yes", "No", "No"],
            "TRANSF. FROM": [None, None, None, "Site A", None],
            "TRANSF. TO": [None, None, None, "Site B", None],
            "REMARKS": ["OK", "Minor repair needed", "Major breakdown - not seen", "Transferred", "Good"],
        })

        # Map columns
        result = map_columns(df, WEEKLY_COLUMN_MAP)

        # Verify all columns mapped
        assert "fleet_number" in result.columns
        assert "description" in result.columns
        assert "physical_verification" in result.columns
        assert "hours_worked" in result.columns
        assert "standby_hours" in result.columns
        assert "breakdown_hours" in result.columns
        assert "off_hire" in result.columns
        assert "transfer_from" in result.columns
        assert "transfer_to" in result.columns
        assert "remarks" in result.columns

        # Process each row and verify logic
        for idx, row in result.iterrows():
            fleet = normalize_fleet_number(row["fleet_number"])
            phys_ver = derive_physical_verification(
                row["physical_verification"],
                row["remarks"]
            )
            hours = parse_hours(row["hours_worked"])
            standby = parse_hours(row["standby_hours"])
            breakdown = parse_hours(row["breakdown_hours"])
            off_hire = parse_off_hire(row["off_hire"])

            # Verify specific rows
            if fleet == "PW 001":
                assert phys_ver is True
                assert hours == 40.0
                assert standby == 8.0
                assert breakdown == 0.0
                assert off_hire is False

            elif fleet == "PW 003":
                # "O" in column and "not seen" in remarks
                assert phys_ver is False
                assert hours == 0.0
                assert breakdown == 48.0
                assert off_hire is True

            elif fleet == "PW 004":
                # No explicit verification, but remarks don't indicate "not seen"
                assert phys_ver is True
                assert row.get("transfer_from") == "Site A"
                assert row.get("transfer_to") == "Site B"

    def test_varying_case_real_world_scenario(self):
        """Test with realistic mixed-case column names from different Excel files."""
        # Some users might have different Excel templates
        templates = [
            # Template 1: All uppercase
            {
                "FLEET NO": ["PW 001"],
                "HOURS WORKED": [40],
                "PHYSICAL VERIFICATION": ["P"],
            },
            # Template 2: Title case
            {
                "Fleet No": ["PW 002"],
                "Hours Worked": [35],
                "Physical Verification": ["P"],
            },
            # Template 3: All lowercase
            {
                "fleet no": ["PW 003"],
                "hours worked": [30],
                "physical verification": ["O"],
            },
            # Template 4: Mixed with periods
            {
                "Fleet No.": ["PW 004"],
                "Hrs Worked": ["25 hrs"],
                "P.P.V": ["P"],
            },
        ]

        for i, template in enumerate(templates):
            df = pd.DataFrame(template)
            result = map_columns(df, WEEKLY_COLUMN_MAP)

            assert "fleet_number" in result.columns, f"Template {i+1} failed fleet_number mapping"
            assert "hours_worked" in result.columns, f"Template {i+1} failed hours_worked mapping"
            assert "physical_verification" in result.columns, f"Template {i+1} failed physical_verification mapping"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
