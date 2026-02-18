#!/bin/bash

# Quick test script for preview-based upload

echo "=========================================="
echo "QUICK TEST: Preview-Based Upload"
echo "=========================================="
echo ""

# Check if server is running
echo "Checking if server is running..."
if ! curl -s http://localhost:8000/ > /dev/null 2>&1; then
    echo "❌ Server is not running!"
    echo "Start it with: uvicorn app.main:app --reload"
    exit 1
fi
echo "✓ Server is running"
echo ""

# Check for auth token
if [ ! -f "auth_token.txt" ]; then
    echo "⚠️  No auth token found"
    echo ""
    echo "Getting auth token..."
    python get_auth_token.py
    echo ""
fi

# Run the test
if [ -f "auth_token.txt" ]; then
    echo "Running preview test..."
    echo ""
    python test_preview_upload.py
else
    echo "❌ No auth token available. Cannot proceed."
    exit 1
fi
