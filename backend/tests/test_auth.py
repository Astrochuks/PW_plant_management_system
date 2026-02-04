#!/usr/bin/env python3
"""
Authentication Test Suite
=========================
Run with your server running:
    cd backend && uvicorn app.main:app --reload

Then in another terminal:
    python tests/test_auth.py

What to watch in the server terminal:
    - Request timing (duration_ms)
    - Rate limit warnings
    - Login success/failure logs
"""

import time
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import httpx
except ImportError:
    print("Installing httpx...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "httpx", "-q"])
    import httpx

BASE_URL = "http://localhost:8000/api/v1"


def print_result(name, response, elapsed_ms):
    """Pretty print a test result."""
    status = response.status_code
    icon = "PASS" if status in (200, 201, 401, 403, 429) else "FAIL"

    # Color codes
    if status in (200, 201):
        color = "\033[92m"  # green
    elif status in (401, 403):
        color = "\033[93m"  # yellow
    elif status == 429:
        color = "\033[91m"  # red
    else:
        color = "\033[91m"  # red
    reset = "\033[0m"

    print(f"  {color}[{icon}]{reset} {name}: HTTP {status} ({elapsed_ms:.0f}ms)")

    # Show relevant response data
    try:
        data = response.json()
        if "message" in data:
            print(f"        Message: {data['message']}")
        if "code" in data:
            print(f"        Code: {data['code']}")
    except Exception:
        pass


def test_health():
    """Test health endpoint."""
    print("\n" + "=" * 60)
    print("TEST 1: Health Check")
    print("=" * 60)

    start = time.time()
    r = httpx.get(f"{BASE_URL}/health")
    elapsed = (time.time() - start) * 1000
    print_result("Health check", r, elapsed)


def test_login_invalid():
    """Test login with wrong credentials."""
    print("\n" + "=" * 60)
    print("TEST 2: Invalid Login (should fail fast)")
    print("=" * 60)

    start = time.time()
    r = httpx.post(f"{BASE_URL}/auth/login", json={
        "email": "wrong@wrong.com",
        "password": "wrongpassword123"
    })
    elapsed = (time.time() - start) * 1000
    print_result("Invalid credentials", r, elapsed)
    print(f"        Target: <800ms | Actual: {elapsed:.0f}ms")


def test_login_valid(email, password):
    """Test login with valid credentials."""
    print("\n" + "=" * 60)
    print("TEST 3: Valid Login")
    print("=" * 60)

    start = time.time()
    r = httpx.post(f"{BASE_URL}/auth/login", json={
        "email": email,
        "password": password
    })
    elapsed = (time.time() - start) * 1000
    print_result("Valid login", r, elapsed)
    print(f"        Target: <800ms | Actual: {elapsed:.0f}ms")

    if r.status_code == 200:
        data = r.json()
        token = data.get("access_token")
        user = data.get("user", {})
        print(f"        User: {user.get('email')} ({user.get('role')})")
        return token
    return None


def test_rate_limiting():
    """Test rate limiting - 5 failures should lock."""
    print("\n" + "=" * 60)
    print("TEST 4: Rate Limiting (5 failures = lockout)")
    print("=" * 60)

    email = "ratelimit_test@test.com"

    for i in range(7):
        start = time.time()
        r = httpx.post(f"{BASE_URL}/auth/login", json={
            "email": email,
            "password": "wrongpassword123"
        })
        elapsed = (time.time() - start) * 1000
        print_result(f"Attempt {i+1}", r, elapsed)

        if r.status_code == 429:
            print(f"\n  Account LOCKED after {i+1} attempts!")
            break

    # Try one more - should be locked
    start = time.time()
    r = httpx.post(f"{BASE_URL}/auth/login", json={
        "email": email,
        "password": "wrongpassword123"
    })
    elapsed = (time.time() - start) * 1000
    print_result("After lockout", r, elapsed)


def test_concurrent_logins():
    """Test multiple simultaneous login attempts."""
    print("\n" + "=" * 60)
    print("TEST 5: Concurrent Logins (10 simultaneous)")
    print("=" * 60)

    def do_login(i):
        start = time.time()
        r = httpx.post(f"{BASE_URL}/auth/login", json={
            "email": f"concurrent{i}@test.com",
            "password": "wrongpassword123"
        })
        elapsed = (time.time() - start) * 1000
        return i, r.status_code, elapsed

    start_all = time.time()
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(do_login, i): i for i in range(10)}
        results = []
        for future in as_completed(futures):
            results.append(future.result())
    total = (time.time() - start_all) * 1000

    results.sort(key=lambda x: x[0])
    for i, status, elapsed in results:
        icon = "\033[92m" if status in (200, 401) else "\033[91m"
        print(f"  {icon}[OK]\033[0m Request {i+1}: HTTP {status} ({elapsed:.0f}ms)")

    times = [r[2] for r in results]
    print(f"\n  Total wall time: {total:.0f}ms")
    print(f"  Avg per request: {sum(times)/len(times):.0f}ms")
    print(f"  Fastest: {min(times):.0f}ms")
    print(f"  Slowest: {max(times):.0f}ms")

    statuses = [r[1] for r in results]
    print(f"  All succeeded: {'Yes' if all(s in (200, 401, 429) for s in statuses) else 'No'}")


def test_protected_routes(token=None):
    """Test protected routes with and without token."""
    print("\n" + "=" * 60)
    print("TEST 6: Protected Routes")
    print("=" * 60)

    # Without token
    start = time.time()
    r = httpx.get(f"{BASE_URL}/auth/me")
    elapsed = (time.time() - start) * 1000
    print_result("GET /me (no token)", r, elapsed)

    if token:
        # With token
        headers = {"Authorization": f"Bearer {token}"}

        start = time.time()
        r = httpx.get(f"{BASE_URL}/auth/me", headers=headers)
        elapsed = (time.time() - start) * 1000
        print_result("GET /me (with token)", r, elapsed)

        # Admin endpoints
        start = time.time()
        r = httpx.get(f"{BASE_URL}/auth/events", headers=headers)
        elapsed = (time.time() - start) * 1000
        print_result("GET /auth/events (audit log)", r, elapsed)

        start = time.time()
        r = httpx.get(f"{BASE_URL}/auth/login-attempts", headers=headers)
        elapsed = (time.time() - start) * 1000
        print_result("GET /auth/login-attempts", r, elapsed)

        start = time.time()
        r = httpx.get(f"{BASE_URL}/auth/lockouts", headers=headers)
        elapsed = (time.time() - start) * 1000
        print_result("GET /auth/lockouts", r, elapsed)


def test_auth_events_logged(token=None):
    """Verify auth events are being recorded."""
    print("\n" + "=" * 60)
    print("TEST 7: Verify Audit Logging")
    print("=" * 60)

    if not token:
        print("  [SKIP] Need admin token to check audit logs")
        return

    headers = {"Authorization": f"Bearer {token}"}

    r = httpx.get(f"{BASE_URL}/auth/events?limit=5", headers=headers)
    if r.status_code == 200:
        data = r.json()
        events = data.get("data", [])
        total = data.get("meta", {}).get("total", 0)
        print(f"  Total auth events: {total}")
        print(f"  Recent events:")
        for event in events[:5]:
            print(f"    - {event['event_type']} | {event['email']} | {event['created_at'][:19]}")

    r = httpx.get(f"{BASE_URL}/auth/login-attempts?limit=5", headers=headers)
    if r.status_code == 200:
        data = r.json()
        total = data.get("meta", {}).get("total", 0)
        attempts = data.get("data", [])
        print(f"\n  Total login attempts: {total}")
        print(f"  Recent attempts:")
        for attempt in attempts[:5]:
            status = "SUCCESS" if attempt['success'] else "FAILED"
            reason = attempt.get('failure_reason', '-')
            print(f"    - {status} | {attempt['email']} | {reason} | {attempt['created_at'][:19]}")


def main():
    print("=" * 60)
    print("  PLANT MANAGEMENT SYSTEM - AUTH TEST SUITE")
    print("  Server: " + BASE_URL)
    print("=" * 60)

    # Check server is running
    try:
        r = httpx.get(f"{BASE_URL}/health", timeout=5)
        print(f"\n  Server status: {r.json().get('status', 'unknown')}")
    except Exception:
        print("\n  ERROR: Server not running!")
        print("  Start it with: cd backend && uvicorn app.main:app --reload")
        sys.exit(1)

    # Run tests
    test_health()
    test_login_invalid()

    # Ask for valid credentials
    print("\n" + "-" * 60)
    email = input("  Enter admin email (or press Enter to skip valid login tests): ").strip()
    token = None
    if email:
        password = input("  Enter password: ").strip()
        token = test_login_valid(email, password)

    test_rate_limiting()
    test_concurrent_logins()
    test_protected_routes(token)
    test_auth_events_logged(token)

    print("\n" + "=" * 60)
    print("  ALL TESTS COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    main()
