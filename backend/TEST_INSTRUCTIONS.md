# Testing the Preview-Based Upload System

## Quick Start

### Step 1: Get Authentication Token

Run the login script to get your admin token:

```bash
cd /Users/ram/Desktop/Projects/PW_plant_management_system/backend
python get_auth_token.py
```

Enter your admin credentials when prompted. The token will be saved to `auth_token.txt`.

### Step 2: Test the Preview Endpoint

Run the test script:

```bash
python test_preview_upload.py
```

This will:
1. Load the test Excel file (`DANSADAU ZAMFARA WEEK 4.xlsx`)
2. Call the preview endpoint
3. Show you the results:
   - Total plants extracted
   - Auto-detected conditions (working, standby, breakdown, etc.)
   - Confidence levels (high/medium/low)
   - Missing plants from previous week
   - New plants this week
   - Detected transfers

### Step 3: Review the Results

Check the output for:
- ✅ **High confidence** plants - Auto-detection worked well
- ⚠️ **Medium confidence** - Based on hours, might need review
- ❌ **Low confidence** - Admin should verify these

The full JSON result is saved to `preview_result.json` for detailed inspection.

## What to Look For

### Condition Detection
- "working" remarks → detected as `working`
- "standby" remarks → detected as `standby`
- "no engine", "burned" → detected as `breakdown`
- "sent for rebore" → detected as `under_repair`
- Hours data used when remarks unclear

### Transfer Detection
- "transferred to KADUNA" → `transfer_to: KADUNA`
- "on the way to KADUNA" → `transfer_to: KADUNA`
- "from JOS" → `transfer_from: JOS`
- "on the way from JOS" → `transfer_from: JOS`

### Missing Plants
- Plants in previous week but not in current week
- System alerts you to these for action

## Manual Testing with cURL

If you prefer to test directly with cURL:

```bash
# 1. Get locations first
curl -X GET "http://localhost:8000/api/v1/locations" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 2. Preview upload
curl -X POST "http://localhost:8000/api/v1/uploads/admin/preview-weekly-report" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@/Users/ram/Desktop/Projects/PW_plant_management_system/new plants/DANSADAU ZAMFARA WEEK 4.xlsx" \
  -F "location_id=LOCATION_UUID_HERE" \
  -F "week_ending_date=2025-01-31"
```

## Expected Results

For a typical weekly report with ~30-50 plants, you should see:

- **Processing time**: < 2 seconds (no AI delays!)
- **High confidence**: ~80-90% of plants
- **Low confidence**: ~5-10% (these need admin review)
- **Transfers detected**: Any plants with "transferred to" or "from" in remarks
- **Missing plants**: Plants that were in previous week but not this week

## Troubleshooting

### "Server not running"
Start the backend:
```bash
cd /Users/ram/Desktop/Projects/PW_plant_management_system/backend
uvicorn app.main:app --reload
```

### "Authentication failed"
- Make sure you ran `python get_auth_token.py` first
- Check that your user has admin role
- Token expires after some time - get a new one

### "No locations found"
- Check your database has locations
- Verify Supabase connection in `.env`

### "File not found"
- The test file path is in `test_preview_upload.py`
- Change `TEST_FILE` to point to any weekly report Excel file

## Next: Testing the Confirm Endpoint

Once preview works, you can test the confirm endpoint by:

1. Running the preview
2. Copying the preview data
3. Making modifications (change conditions, add transfers)
4. Sending to confirm endpoint

I can create a separate test script for this if needed!
