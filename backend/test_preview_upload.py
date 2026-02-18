"""Test script for preview-based upload endpoints.

Tests the new preview and confirm workflow without needing frontend.
"""

import asyncio
import json
from datetime import date
from pathlib import Path

import httpx


# Configuration
API_BASE_URL = "http://localhost:8000/api/v1"
TEST_FILE = Path(__file__).parent.parent / "new plants" / "DANSADAU ZAMFARA WEEK 4.xlsx"

# You'll need to set these based on your Supabase data
TEST_LOCATION_ID = None  # Will be fetched from API
TEST_WEEK_ENDING = date(2025, 1, 31)  # Week 4 ending


async def get_auth_token():
    """Get authentication token.

    Tries to read from auth_token.txt first, otherwise prompts.
    """
    # Try to read from saved token file
    token_file = Path(__file__).parent / "auth_token.txt"
    if token_file.exists():
        token = token_file.read_text().strip()
        if token:
            print(f"✓ Using saved token from {token_file.name}")
            return token

    print("\n⚠️  No saved token found")
    print("\nOptions:")
    print("1. Run: python get_auth_token.py (to login and save token)")
    print("2. Enter token manually below")
    print("3. Press Enter to skip auth (will fail)")

    token = input("\nEnter admin auth token: ").strip()
    return token or None


async def get_locations(client: httpx.AsyncClient, headers: dict):
    """Fetch available locations."""
    response = await client.get(f"{API_BASE_URL}/locations", headers=headers)
    response.raise_for_status()
    data = response.json()
    return data.get("data", [])


async def test_preview_endpoint(auth_token: str | None):
    """Test the preview endpoint with a real file."""

    async with httpx.AsyncClient(timeout=60.0) as client:
        headers = {}
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        print("\n" + "="*60)
        print("STEP 1: Fetching locations...")
        print("="*60)

        try:
            locations = await get_locations(client, headers)
            print(f"✓ Found {len(locations)} locations")

            # Find DANSADAU location (or use first available)
            location = next(
                (loc for loc in locations if "DANSADAU" in loc.get("name", "").upper()),
                locations[0] if locations else None
            )

            if not location:
                print("❌ No locations found. Please check your database.")
                return

            location_id = location["id"]
            location_name = location["name"]
            print(f"✓ Using location: {location_name} ({location_id})")

        except httpx.HTTPStatusError as e:
            print(f"❌ Failed to fetch locations: {e}")
            print(f"Response: {e.response.text}")
            return

        print("\n" + "="*60)
        print("STEP 2: Testing preview endpoint...")
        print("="*60)
        print(f"File: {TEST_FILE.name}")
        print(f"Location: {location_name}")
        print(f"Week Ending: {TEST_WEEK_ENDING}")

        if not TEST_FILE.exists():
            print(f"❌ Test file not found: {TEST_FILE}")
            return

        # Prepare multipart form data
        files = {
            "file": (TEST_FILE.name, open(TEST_FILE, "rb"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        }

        data = {
            "location_id": str(location_id),
            "week_ending_date": str(TEST_WEEK_ENDING),
        }

        try:
            print("\n⏳ Uploading and processing file...")
            response = await client.post(
                f"{API_BASE_URL}/uploads/admin/preview-weekly-report",
                files=files,
                data=data,
                headers=headers
            )

            response.raise_for_status()
            result = response.json()

            print("\n✅ Preview generated successfully!")
            print("\n" + "="*60)
            print("PREVIEW RESULTS:")
            print("="*60)

            # Summary
            summary = result.get("summary", {})
            print(f"\n📊 Summary:")
            print(f"  Total plants in file: {summary.get('total_in_file')}")
            print(f"  Missing from previous week: {summary.get('missing_from_previous')}")
            print(f"  New this week: {summary.get('new_this_week')}")
            print(f"  High confidence: {summary.get('high_confidence')}")
            print(f"  Medium confidence: {summary.get('medium_confidence')}")
            print(f"  Low confidence: {summary.get('low_confidence')}")

            # Condition breakdown
            condition_breakdown = summary.get("condition_breakdown", {})
            if condition_breakdown:
                print(f"\n🏭 Condition Breakdown:")
                for condition, count in sorted(condition_breakdown.items(), key=lambda x: -x[1]):
                    print(f"  {condition}: {count}")

            # Sample plants
            plants = result.get("plants", [])
            if plants:
                print(f"\n📋 Sample Plants (first 10):")
                for i, plant in enumerate(plants[:10], 1):
                    confidence = plant.get("condition_confidence", "unknown")
                    confidence_emoji = {"high": "✓", "medium": "⚠️", "low": "❌"}.get(confidence, "?")

                    print(f"\n  {i}. {plant.get('fleet_number')} - {plant.get('description', 'N/A')}")
                    print(f"     Remarks: {plant.get('remarks', 'None')[:60]}")
                    print(f"     Hours: W={plant.get('hours_worked')} S={plant.get('standby_hours')} B={plant.get('breakdown_hours')}")
                    print(f"     Condition: {plant.get('detected_condition')} {confidence_emoji} ({confidence})")
                    if plant.get('condition_reason'):
                        print(f"     Reason: {plant.get('condition_reason')[:80]}")

                    # Transfers
                    if plant.get('detected_transfer_to_name'):
                        print(f"     Transfer TO: {plant.get('detected_transfer_to_name')}")
                    if plant.get('detected_transfer_from_name'):
                        print(f"     Transfer FROM: {plant.get('detected_transfer_from_name')}")

            # Low confidence plants (need review)
            low_conf_plants = [p for p in plants if p.get("condition_confidence") == "low"]
            if low_conf_plants:
                print(f"\n⚠️  Low Confidence Plants (need admin review):")
                for plant in low_conf_plants[:5]:
                    print(f"  - {plant.get('fleet_number')}: {plant.get('detected_condition')} - {plant.get('condition_reason')}")
                if len(low_conf_plants) > 5:
                    print(f"  ... and {len(low_conf_plants) - 5} more")

            # Missing plants
            missing_plants = result.get("missing_plants", [])
            if missing_plants:
                print(f"\n❓ Missing Plants (in week {summary.get('missing_from_previous', 0)} but not this week):")
                for plant in missing_plants[:5]:
                    print(f"  - {plant.get('fleet_number')} - Last seen: Week {plant.get('last_seen_week')}")
                if len(missing_plants) > 5:
                    print(f"  ... and {len(missing_plants) - 5} more")

            # Save full result to file for inspection
            output_file = Path(__file__).parent / "preview_result.json"
            with open(output_file, "w") as f:
                json.dump(result, f, indent=2, default=str)
            print(f"\n💾 Full result saved to: {output_file}")

            print("\n" + "="*60)
            print("NEXT STEPS:")
            print("="*60)
            print("1. Review the preview results above")
            print("2. Check low-confidence plants")
            print("3. Verify condition detection is working")
            print("4. If satisfied, you can test the confirm endpoint")
            print(f"5. Preview ID: {result.get('preview_id')}")

            return result

        except httpx.HTTPStatusError as e:
            print(f"\n❌ Preview failed: {e}")
            print(f"Status: {e.response.status_code}")
            print(f"Response: {e.response.text}")
            return None

        except Exception as e:
            print(f"\n❌ Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            return None


async def main():
    """Run the test."""
    print("="*60)
    print("TESTING PREVIEW-BASED UPLOAD SYSTEM")
    print("="*60)

    # Get auth token
    auth_token = await get_auth_token()

    if not auth_token:
        print("\n⚠️  WARNING: Running without authentication")
        print("The endpoint requires admin auth. This will likely fail.")
        cont = input("Continue anyway? (y/N): ").strip().lower()
        if cont != 'y':
            print("Exiting.")
            return

    # Test preview
    result = await test_preview_endpoint(auth_token)

    if result:
        print("\n✅ Test completed successfully!")
    else:
        print("\n❌ Test failed. Check the errors above.")


if __name__ == "__main__":
    asyncio.run(main())
